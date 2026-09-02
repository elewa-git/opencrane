import { ConversationCreationReservationState, ConversationMode, type Prisma } from "@prisma/client";

import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ConversationModes } from "@opencrane/models/conversations";

import { ConversationCreationReservationStates, type AnchorConversationCreationReservationCommand, type ConversationCreationReservationRepository, type ReserveConversationCreationCommand, type ReserveConversationCreationResult, type ReservedConversationCreation } from "../conversation-creation-reservation.types";
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
			return prior.requestDigest === command.requestDigest ? { outcome: "idempotent", value: _Reserved(prior) } : { outcome: "idempotency_conflict" };

		const authorization = new PrismaConversationProductAuthorizationRepository(this.transaction);
		const evidence = await authorization.admitEvidence(this.caller, { kind: ProductAuthorizationResourceKinds.ConversationCollection, id: command.siloId }, ProductAuthorizationActions.Create, __ConversationCreationReservationAuthorizationArguments(command));
		if (evidence === null)
			return { outcome: "denied" };

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
				participants: { create: command.participants.map(function _Participant(participant, index) { return { ordinal: index + 1, userId: participant.userId, visibleFromPosition: BigInt(participant.visibleFromPosition), joinedAt: new Date(participant.joinedAt) }; }) },
			},
			include: { participants: { orderBy: { ordinal: "asc" } } },
		});
		return { outcome: "reserved", value: _Reserved(created) };
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
		const existing = _Reserved(reservation);
		_AssertAnchorBinding(existing, command.agentBinding);
		if (existing.state !== ConversationCreationReservationStates.Reserved)
			return existing;
		const updated = await this.transaction.conversationCreationReservation.update({
			where: { id: command.reservationId },
			data: {
				state: ConversationCreationReservationState.HistoryAnchored,
				historyRevision: 0n,
				historyAnchoredAt: new Date(),
				agentIdentityId: command.agentBinding?.agentIdentityId ?? null,
				profileRevisionId: command.agentBinding?.profileRevisionId ?? null,
			},
			include: { participants: { orderBy: { ordinal: "asc" } } },
		});
		return _Reserved(updated);
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
function _Reserved(reservation: { readonly id: string; readonly siloId: string; readonly principalId: string; readonly requestId: string; readonly requestDigest: string; readonly conversationId: string; readonly historyEventId: string; readonly authorizationDecisionEvidenceId: string; readonly mode: ConversationMode; readonly agentServiceId: string | null; readonly agentRevisionId: string | null; readonly agentIdentityId: string | null; readonly profileRevisionId: string | null; readonly computerId: string | null; readonly computerHistoryEventId: string | null; readonly state: ConversationCreationReservationState; readonly participants: readonly { readonly userId: string; readonly visibleFromPosition: bigint; readonly joinedAt: Date }[] }): ReservedConversationCreation
{
	return {
		reservationId: reservation.id,
		siloId: reservation.siloId,
		principalId: reservation.principalId,
		requestId: reservation.requestId,
		requestDigest: reservation.requestDigest as `sha256:${string}`,
		conversationId: reservation.conversationId,
		historyEventId: reservation.historyEventId,
		mode: _ConversationMode(reservation.mode),
		participants: reservation.participants.map(function _Participant(participant) { return { userId: participant.userId, visibleFromPosition: participant.visibleFromPosition.toString(), joinedAt: participant.joinedAt.toISOString() }; }),
		agent: _Agent(reservation),
		resolvedAgentBinding: _ResolvedAgentBinding(reservation),
		authorizationEvidenceId: reservation.authorizationDecisionEvidenceId,
		state: _State(reservation.state),
	};
}

/** Refuses malformed post-history coordinates before they can advance a durable reservation. */
function _ValidateAnchorCommand(command: AnchorConversationCreationReservationCommand): void
{
	if (command.reservationId.trim().length === 0 || command.reservationId !== command.reservationId.trim())
		throw new Error("Conversation creation history anchoring requires a reservation identifier");
	if (command.agentBinding !== null && (command.agentBinding.agentIdentityId.trim().length === 0 || command.agentBinding.agentIdentityId !== command.agentBinding.agentIdentityId.trim() || command.agentBinding.profileRevisionId.trim().length === 0 || command.agentBinding.profileRevisionId !== command.agentBinding.profileRevisionId.trim()))
		throw new Error("Conversation creation history anchoring requires complete agent identity and profile coordinates");
}

/** Ensures direct/group never gain agent facts, while Agent reservations cannot advance without them. */
function _AssertAnchorBinding(reservation: ReservedConversationCreation, binding: AnchorConversationCreationReservationCommand["agentBinding"]): void
{
	if (reservation.agent === null && binding !== null)
		throw new Error("Direct and group conversation reservations cannot receive an agent binding");
	if (reservation.agent !== null && binding === null)
		throw new Error("Agent conversation reservations require an agent binding");
	if (reservation.resolvedAgentBinding !== null && (binding === null || reservation.resolvedAgentBinding.agentIdentityId !== binding.agentIdentityId || reservation.resolvedAgentBinding.profileRevisionId !== binding.profileRevisionId))
		throw new Error("Conversation creation reservation has a conflicting agent binding");
}

/** Restores agent coordinates only from the all-or-nothing reserved database columns. */
function _Agent(reservation: { readonly agentServiceId: string | null; readonly agentRevisionId: string | null; readonly computerId: string | null; readonly computerHistoryEventId: string | null }): ReservedConversationCreation["agent"]
{
	if (reservation.agentServiceId === null && reservation.agentRevisionId === null && reservation.computerId === null && reservation.computerHistoryEventId === null)
		return null;
	if (reservation.agentServiceId === null || reservation.agentRevisionId === null || reservation.computerId === null || reservation.computerHistoryEventId === null)
		throw new Error("Conversation creation reservation has incomplete agent coordinates");
	return { agentServiceId: reservation.agentServiceId, agentRevisionId: reservation.agentRevisionId, computerId: reservation.computerId, computerHistoryEventId: reservation.computerHistoryEventId };
}

/** Restores the all-or-nothing post-history Agent binding without exposing Prisma records. */
function _ResolvedAgentBinding(reservation: { readonly agentIdentityId: string | null; readonly profileRevisionId: string | null }): ReservedConversationCreation["resolvedAgentBinding"]
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
