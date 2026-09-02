import { ConversationCreationReservationState, ConversationMode, type Prisma } from "@prisma/client";

import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ConversationModes } from "@opencrane/models/conversations";

import { ConversationCreationReservationOutcomes, ConversationCreationReservationStates, type AnchorConversationCreationReservationCommand, type ConversationCreationReservationRepository, type ProjectConversationCreationReservationCommand, type RecoverConversationCreationReservationCommand, type ReserveConversationCreationCommand, type ReserveConversationCreationResult, type ReservedConversationCreation } from "../conversation-creation-reservation.types";
import { __ConversationCreationReservationAuthorizationArguments, __ValidateConversationCreationReservation } from "../conversation-creation-reservation.validation";
import type { ConversationCaller } from "../types/conversation-caller.types";
import { PrismaConversationProductAuthorizationRepository } from "./conversation-product-authorization";

/** Writes and recovers one authorization-evidenced creation command before any history I/O begins. */
export class PrismaConversationCreationReservationRepository implements ConversationCreationReservationRepository
{
	/** Holds the serializable transaction that commits the command and its audit decision together. */
	public constructor(private readonly transaction: Prisma.TransactionClient, private readonly caller: ConversationCaller) {}

	/** @inheritdoc */
	public async reserve(command: ReserveConversationCreationCommand): Promise<ReserveConversationCreationResult>
	{
		__ValidateConversationCreationReservation(command, this.caller);
		const prior = await this.transaction.conversationCreationReservation.findUnique({
			where: { siloId_principalId_requestId: { siloId: command.siloId, principalId: command.principalId, requestId: command.requestId } },
			include: { participants: { orderBy: { ordinal: "asc" } } },
		});
		if (prior !== null)
			return prior.requestDigest === command.requestDigest ? { outcome: ConversationCreationReservationOutcomes.Idempotent, value: _Reserved(prior) } : { outcome: ConversationCreationReservationOutcomes.IdempotencyConflict };

		const authorization = new PrismaConversationProductAuthorizationRepository(this.transaction);
		const evidence = await authorization.admitEvidence(this.caller, { kind: ProductAuthorizationResourceKinds.ConversationCollection, id: command.siloId }, ProductAuthorizationActions.Create, __ConversationCreationReservationAuthorizationArguments(command));
		if (evidence === null)
			return { outcome: ConversationCreationReservationOutcomes.Denied };

		const created = await this.transaction.conversationCreationReservation.create({
			data: {
				siloId: command.siloId,
				principalId: command.principalId,
				requestId: command.requestId,
				requestDigest: command.requestDigest,
				conversationId: command.conversationId,
				historyEventId: command.historyEventId,
				authorizationDecisionEvidenceId: evidence.decisionEvidenceId,
				authorizationDecisionDigest: evidence.decisionDigest,
				authorizationPolicyRevisionHash: evidence.policyRevisionHash,
				effectiveAuthorizationDigest: evidence.effectiveAuthorizationDigest,
				mode: _Mode(command.mode),
				agentServiceId: command.agent?.agentServiceId ?? null,
				agentRevisionId: command.agent?.agentRevisionId ?? null,
				computerId: command.agent?.computerId ?? null,
				computerHistoryEventId: command.agent?.computerHistoryEventId ?? null,
				computerClaimEventId: command.agent?.computerClaimEventId ?? null,
				computerActivationEventId: command.agent?.computerActivationEventId ?? null,
				computerLeaseClaimedAt: command.agent === null ? null : new Date(command.agent.computerLeaseClaimedAt),
				computerLeaseExpiresAt: command.agent === null ? null : new Date(command.agent.computerLeaseExpiresAt),
				agentIdentityId: command.agentBinding?.agentIdentityId ?? null,
				profileRevisionId: command.agentBinding?.profileRevisionId ?? null,
				participants: { create: command.participants.map(function _Participant(participant, index) { return { ordinal: index + 1, userId: participant.userId, visibleFromPosition: BigInt(participant.visibleFromPosition), joinedAt: new Date(participant.joinedAt) }; }) },
			},
			include: { participants: { orderBy: { ordinal: "asc" } } },
		});
		return { outcome: ConversationCreationReservationOutcomes.Reserved, value: _Reserved(created) };
	}

	/** @inheritdoc */
	public async recover(command: RecoverConversationCreationReservationCommand): Promise<ReserveConversationCreationResult | null>
	{
		_ValidateRecoveryCommand(command);
		const prior = await this.transaction.conversationCreationReservation.findUnique({
			where: { siloId_principalId_requestId: { siloId: this.caller.siloId, principalId: this.caller.principalId, requestId: command.requestId } },
			include: { participants: { orderBy: { ordinal: "asc" } } },
		});
		if (prior === null)
			return null;
		return prior.requestDigest === command.requestDigest
			? { outcome: ConversationCreationReservationOutcomes.Idempotent, value: _Reserved(prior) }
			: { outcome: ConversationCreationReservationOutcomes.IdempotencyConflict };
	}

	/** @inheritdoc */
	public async markHistoryAnchored(command: AnchorConversationCreationReservationCommand): Promise<ReservedConversationCreation>
	{
		_ValidateAnchorCommand(command);
		const reservation = await this.transaction.conversationCreationReservation.findUnique({
			where: { id: command.reservationId },
			include: { participants: { orderBy: { ordinal: "asc" } } },
		});
		if (reservation === null)
			throw new Error("Conversation creation reservation is unavailable");
		if (reservation.siloId !== this.caller.siloId || reservation.principalId !== this.caller.principalId)
			throw new Error("Conversation creation reservation is unavailable");
		const existing = _Reserved(reservation);
		_AssertAnchorBinding(existing);
		if (existing.state !== ConversationCreationReservationStates.Reserved)
			return existing;
		const updated = await this.transaction.conversationCreationReservation.update({
			where: { id: command.reservationId },
			data: {
				state: ConversationCreationReservationState.HistoryAnchored,
				historyRevision: 0n,
				historyAnchoredAt: new Date(),
			},
			include: { participants: { orderBy: { ordinal: "asc" } } },
		});
		return _Reserved(updated);
	}

	/** @inheritdoc */
	public async markProjected(command: ProjectConversationCreationReservationCommand): Promise<ReservedConversationCreation>
	{
		_ValidateProjectionCommand(command);
		const reservation = await this.transaction.conversationCreationReservation.findUnique({
			where: { id: command.reservationId },
			include: { participants: { orderBy: { ordinal: "asc" } } },
		});
		if (reservation === null)
			throw new Error("Conversation creation reservation is unavailable");
		if (reservation.siloId !== this.caller.siloId || reservation.principalId !== this.caller.principalId)
			throw new Error("Conversation creation reservation is unavailable");
		const existing = _Reserved(reservation);
		if (existing.state === ConversationCreationReservationStates.Projected)
			return existing;
		if (existing.state !== ConversationCreationReservationStates.HistoryAnchored)
			throw new Error("Conversation creation projection requires a history-anchored reservation");
		// Advance only the anchored row so a concurrent projector cannot overwrite its own completed transition.
		const transitioned = await this.transaction.conversationCreationReservation.updateMany({
			where: { id: command.reservationId, state: ConversationCreationReservationState.HistoryAnchored },
			data: { state: ConversationCreationReservationState.Projected, projectedAt: new Date() },
		});
		// Reload the row so a competing projector's completed transition becomes this call's idempotent replay.
		const current = await this.transaction.conversationCreationReservation.findUnique({
			where: { id: command.reservationId },
			include: { participants: { orderBy: { ordinal: "asc" } } },
		});
		if (current === null || current.siloId !== this.caller.siloId || current.principalId !== this.caller.principalId)
			throw new Error("Conversation creation reservation is unavailable");
		const projected = _Reserved(current);
		if (projected.state === ConversationCreationReservationStates.Projected)
			return projected;
		if (transitioned.count === 0)
			throw new Error("Conversation creation projection did not converge");
		throw new Error("Conversation creation projection did not persist");
	}
}

/** Maps model-owned mode values to the generated Prisma enum without accepting arbitrary strings. */
function _Mode(mode: ConversationModes): ConversationMode
{
	if (mode === ConversationModes.AgentSession)
		return ConversationMode.AgentSession;
	if (mode === ConversationModes.Direct)
		return ConversationMode.Direct;
	return ConversationMode.Group;
}

/** Converts a fully persisted row to the domain port without exposing Prisma records. */
function _Reserved(reservation: { readonly id: string; readonly siloId: string; readonly principalId: string; readonly requestId: string; readonly requestDigest: string; readonly conversationId: string; readonly historyEventId: string; readonly authorizationDecisionEvidenceId: string; readonly mode: ConversationMode; readonly agentServiceId: string | null; readonly agentRevisionId: string | null; readonly agentIdentityId: string | null; readonly profileRevisionId: string | null; readonly computerId: string | null; readonly computerHistoryEventId: string | null; readonly computerClaimEventId: string | null; readonly computerActivationEventId: string | null; readonly computerLeaseClaimedAt: Date | null; readonly computerLeaseExpiresAt: Date | null; readonly reservedAt: Date; readonly state: ConversationCreationReservationState; readonly participants: readonly { readonly userId: string; readonly visibleFromPosition: bigint; readonly joinedAt: Date }[] }): ReservedConversationCreation
{
	return {
		reservationId: reservation.id,
		createdAt: reservation.reservedAt.toISOString(),
		siloId: reservation.siloId,
		principalId: reservation.principalId,
		requestId: reservation.requestId,
		requestDigest: reservation.requestDigest as `sha256:${string}`,
		conversationId: reservation.conversationId,
		historyEventId: reservation.historyEventId,
		mode: _ConversationMode(reservation.mode),
		participants: reservation.participants.map(function _Participant(participant) { return { userId: participant.userId, visibleFromPosition: participant.visibleFromPosition.toString(), joinedAt: participant.joinedAt.toISOString() }; }),
		agent: _Agent(reservation),
		agentBinding: _ResolvedAgentBinding(reservation),
		authorizationEvidenceId: reservation.authorizationDecisionEvidenceId,
		state: _State(reservation.state),
	};
}

/** Refuses malformed post-history coordinates before they can advance a durable reservation. */
function _ValidateAnchorCommand(command: AnchorConversationCreationReservationCommand): void
{
	if (command.reservationId.trim().length === 0 || command.reservationId !== command.reservationId.trim())
		throw new Error("Conversation creation history anchoring requires a reservation identifier");
}

/** Refuses malformed caller retry coordinates before a recovery lookup reaches PostgreSQL. */
function _ValidateRecoveryCommand(command: RecoverConversationCreationReservationCommand): void
{
	if (command.requestId.trim().length === 0 || command.requestId !== command.requestId.trim())
		throw new Error("Conversation creation recovery requires a request identifier");
	if (!/^sha256:[a-f0-9]{64}$/u.test(command.requestDigest))
		throw new Error("Conversation creation recovery requires a request digest");
}

/** Refuses an empty projection coordinate before it reaches the durable state machine. */
function _ValidateProjectionCommand(command: ProjectConversationCreationReservationCommand): void
{
	if (command.reservationId.trim().length === 0 || command.reservationId !== command.reservationId.trim())
		throw new Error("Conversation creation projection requires a reservation identifier");
}

/** Ensures direct/group never gain agent facts, while Agent reservations retain a complete frozen binding. */
function _AssertAnchorBinding(reservation: ReservedConversationCreation): void
{
	if (reservation.agent === null && reservation.agentBinding !== null)
		throw new Error("Direct and group conversation reservations cannot retain an agent binding");
	if (reservation.agent !== null && reservation.agentBinding === null)
		throw new Error("Agent conversation reservations require a frozen binding");
}

/** Restores agent coordinates only from the all-or-nothing reserved database columns. */
function _Agent(reservation: { readonly agentServiceId: string | null; readonly agentRevisionId: string | null; readonly computerId: string | null; readonly computerHistoryEventId: string | null; readonly computerClaimEventId: string | null; readonly computerActivationEventId: string | null; readonly computerLeaseClaimedAt: Date | null; readonly computerLeaseExpiresAt: Date | null }): ReservedConversationCreation["agent"]
{
	if (reservation.agentServiceId === null && reservation.agentRevisionId === null && reservation.computerId === null && reservation.computerHistoryEventId === null && reservation.computerClaimEventId === null && reservation.computerActivationEventId === null && reservation.computerLeaseClaimedAt === null && reservation.computerLeaseExpiresAt === null)
		return null;
	if (reservation.agentServiceId === null || reservation.agentRevisionId === null || reservation.computerId === null || reservation.computerHistoryEventId === null || reservation.computerClaimEventId === null || reservation.computerActivationEventId === null || reservation.computerLeaseClaimedAt === null || reservation.computerLeaseExpiresAt === null)
		throw new Error("Conversation creation reservation has incomplete agent coordinates");
	return { agentServiceId: reservation.agentServiceId, agentRevisionId: reservation.agentRevisionId, computerId: reservation.computerId, computerHistoryEventId: reservation.computerHistoryEventId, computerClaimEventId: reservation.computerClaimEventId, computerActivationEventId: reservation.computerActivationEventId, computerLeaseClaimedAt: reservation.computerLeaseClaimedAt.toISOString(), computerLeaseExpiresAt: reservation.computerLeaseExpiresAt.toISOString() };
}

/** Restores the all-or-nothing Agent binding frozen with the reservation without exposing Prisma records. */
function _ResolvedAgentBinding(reservation: { readonly agentIdentityId: string | null; readonly profileRevisionId: string | null }): ReservedConversationCreation["agentBinding"]
{
	if (reservation.agentIdentityId === null && reservation.profileRevisionId === null)
		return null;
	if (reservation.agentIdentityId === null || reservation.profileRevisionId === null)
		throw new Error("Conversation creation reservation has incomplete resolved agent coordinates");
	return { agentIdentityId: reservation.agentIdentityId, profileRevisionId: reservation.profileRevisionId };
}

/** Maps the generated progress enum to the public state without widening it to a string. */
function _State(state: ConversationCreationReservationState): ConversationCreationReservationStates
{
	if (state === ConversationCreationReservationState.Reserved)
		return ConversationCreationReservationStates.Reserved;
	if (state === ConversationCreationReservationState.HistoryAnchored)
		return ConversationCreationReservationStates.HistoryAnchored;
	return ConversationCreationReservationStates.Projected;
}

/** Restores the model-owned create mode from the persisted enum. */
function _ConversationMode(mode: ConversationMode): ConversationModes
{
	if (mode === ConversationMode.AgentSession)
		return ConversationModes.AgentSession;
	if (mode === ConversationMode.Direct)
		return ConversationModes.Direct;
	return ConversationModes.Group;
}
