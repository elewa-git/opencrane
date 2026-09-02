import { ConversationLifecycleModes, type ConversationCreated } from "@opencrane/contracts";
import { ConversationModes } from "@opencrane/models/conversations";

import { ConversationCreationAnchorVerifier } from "./conversation-creation-anchor-verifier";
import { ConversationCreationAnchorConfirmationOutcomes } from "./conversation-creation-anchor-verifier.types";
import { ConversationCreationReservationOutcomes, ConversationCreationReservationStates, type RecoverConversationCreationReservationCommand, type ReservedConversationCreation } from "./conversation-creation-reservation.types";
import { ConversationHistoryAuthority } from "./conversation-history-authority";
import { HistoryAnchoredConversationCreationOutcomes, type ConversationCreationProjectionCommand, type ConversationCreationProjectionPort, type ConversationCreationReservationUnitOfWork, type CreateHistoryAnchoredConversationCommand, type HistoryAnchoredConversationCreationResult } from "./history-anchored-conversation-creation-authority.types";

/**
 * Establishes a revision-zero conversation anchor from a durable, authorization-evidenced reservation.
 *
 * This authority deliberately stops at a projection request. PostgreSQL reservation and anchoring
 * protect retry semantics, KurrentDB owns immutable participant history, and a separate projector
 * rebuilds directory rows and grants from the confirmed record.
 */
export class HistoryAnchoredConversationCreationAuthority
{
	/** Holds the durable reservation UoW, immutable history, recovery reader, and projection handoff ports. */
	public constructor(private readonly reservations: ConversationCreationReservationUnitOfWork, private readonly history: Pick<ConversationHistoryAuthority, "create">, private readonly anchorVerifier: Pick<ConversationCreationAnchorVerifier, "confirm">, private readonly projection: ConversationCreationProjectionPort) {}

	/**
	 * Reserves, anchors, confirms, and hands off one new conversation without accepting a caller payload.
	 *
	 * A retry always reloads the reservation before history is touched. A lost append response is
	 * recovered only when the verifier proves the exact reserved revision-zero event; an absent stream
	 * permits one retry of the append, while a mismatched stream remains a corruption error.
	 * @param command - Contains server-resolved command coordinates and trusted Agent-only binding facts.
	 * @returns A denial, retry conflict, projected replay, or the confirmed projection handoff.
	 * @throws {Error} When KurrentDB cannot create or prove the reserved anchor, or projection handoff fails.
	 */
	public async create(command: CreateHistoryAnchoredConversationCommand): Promise<HistoryAnchoredConversationCreationResult>
	{
		// 1. Reservation — commits idempotency and authorization evidence before any history I/O occurs.
		const reservedResult = await this.reservations.reserve(command.reservation);
		if (reservedResult.outcome === ConversationCreationReservationOutcomes.Denied)
			return { outcome: HistoryAnchoredConversationCreationOutcomes.Denied };
		if (reservedResult.outcome === ConversationCreationReservationOutcomes.IdempotencyConflict)
			return { outcome: HistoryAnchoredConversationCreationOutcomes.IdempotencyConflict };
		return this._Continue(reservedResult.value);
	}

	/** Recovers an exact admitted command without recompiling mutable participants or Agent bindings. */
	public async resume(command: RecoverConversationCreationReservationCommand): Promise<HistoryAnchoredConversationCreationResult | null>
	{
		const recovered = await this.reservations.recover(command);
		if (recovered === null)
			return null;
		if (recovered.outcome === ConversationCreationReservationOutcomes.IdempotencyConflict)
			return { outcome: HistoryAnchoredConversationCreationOutcomes.IdempotencyConflict };
		if (recovered.outcome !== ConversationCreationReservationOutcomes.Idempotent)
			throw new Error("Conversation creation recovery returned an unadmitted reservation");
		return this._Continue(recovered.value);
	}

	/** Progresses a stored command through anchor confirmation and its replayable projection handoff. */
	private async _Continue(reservation: ReservedConversationCreation): Promise<HistoryAnchoredConversationCreationResult>
	{
		const created = _Created(reservation);
		if (reservation.state === ConversationCreationReservationStates.Projected)
			return { outcome: HistoryAnchoredConversationCreationOutcomes.Projected, reservation, created };

		// 2. History — writes only the reserved revision-zero envelope, with exact-anchor recovery for ambiguity.
		if (reservation.state === ConversationCreationReservationStates.Reserved)
			await this._CreateOrConfirm(reservation, created);

		// 3. Progress — persists the confirmed anchor before the projector can rebuild relational state.
		const anchored = await this.reservations.markHistoryAnchored({ reservationId: reservation.reservationId });
		const projection = _Projection(anchored);
		await this.projection.request(projection);
		return { outcome: HistoryAnchoredConversationCreationOutcomes.ProjectionNeeded, reservation: anchored, created: _Created(anchored), projection };
	}

	/** Creates the anchor, then proves exactly what KurrentDB retained when an append response is ambiguous. */
	private async _CreateOrConfirm(reservation: ReservedConversationCreation, created: ConversationCreated): Promise<void>
	{
		// 1. Initial append — requests the one server-reserved event id at the no-stream head.
		try
		{
			await this.history.create({ siloId: reservation.siloId, eventId: reservation.historyEventId, created });
			return;
		}
		catch (error)
		{
			// 2. Confirmation — accepts only the exact anchor when the first response may have been lost.
			const confirmation = await this.anchorVerifier.confirm({ siloId: reservation.siloId, eventId: reservation.historyEventId, created });
			if (confirmation.outcome === ConversationCreationAnchorConfirmationOutcomes.Confirmed)
				return;
			// 3. Retry — an absent stream permits one fresh append; a second error remains visible to the caller.
			try
			{
				await this.history.create({ siloId: reservation.siloId, eventId: reservation.historyEventId, created });
				return;
			}
			catch
			{
				const retriedConfirmation = await this.anchorVerifier.confirm({ siloId: reservation.siloId, eventId: reservation.historyEventId, created });
				if (retriedConfirmation.outcome === ConversationCreationAnchorConfirmationOutcomes.Confirmed)
					return;
				throw error;
			}
		}
	}
}

/** Rebuilds the only valid revision-zero payload from durable reservation coordinates. */
function _Created(reservation: ReservedConversationCreation): ConversationCreated
{
	const agentBinding = _CreatedAgentBinding(reservation);
	return {
		schemaVersion: 1,
		conversationId: reservation.conversationId,
		mode: _LifecycleMode(reservation.mode),
		participants: reservation.participants,
		agentBinding,
		createdAt: reservation.createdAt,
		provenance: { principalId: reservation.principalId, authorizationEvidenceId: reservation.authorizationEvidenceId, requestId: reservation.requestId },
	};
}

/** Selects the stored agent binding on recovery or checks the trusted input required before first anchoring. */
function _CreatedAgentBinding(reservation: ReservedConversationCreation): ConversationCreated["agentBinding"]
{
	if (reservation.mode !== ConversationModes.AgentSession)
	{
		if (reservation.agentBinding !== null)
			throw new Error("Direct and group conversation creation cannot carry an agent binding");
		return null;
	}
	if (reservation.agent === null)
		throw new Error("Agent conversation creation requires reserved agent coordinates");
	if (reservation.agentBinding === null)
		throw new Error("Agent conversation creation requires a frozen binding");
	const binding = reservation.agentBinding;
	return { agentServiceId: reservation.agent.agentServiceId, agentRevisionId: reservation.agent.agentRevisionId, agentIdentityId: binding.agentIdentityId, profileRevisionId: binding.profileRevisionId, computerId: reservation.agent.computerId };
}

/** Maps the durable mode to the lifecycle mode serialized in immutable history. */
function _LifecycleMode(mode: ConversationModes): ConversationLifecycleModes
{
	if (mode === ConversationModes.AgentSession)
		return ConversationLifecycleModes.Agent;
	if (mode === ConversationModes.Direct)
		return ConversationLifecycleModes.Direct;
	return ConversationLifecycleModes.Group;
}

/** Gives the projection owner only the durable anchor coordinate it must read and materialize. */
function _Projection(reservation: ReservedConversationCreation): ConversationCreationProjectionCommand
{
	if (reservation.state === ConversationCreationReservationStates.Reserved)
		throw new Error("Conversation projection requires a history-anchored reservation");
	return { reservationId: reservation.reservationId, siloId: reservation.siloId, conversationId: reservation.conversationId, historyRevision: 0n };
}
