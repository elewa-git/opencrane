import type { ConversationCreated } from "@opencrane/contracts";

import type { AnchorConversationCreationReservationCommand, ConversationCreationReservationStates, RecoverConversationCreationReservationCommand, ReserveConversationCreationCommand, ReserveConversationCreationResult, ReservedConversationCreation } from "./conversation-creation-reservation.types";

/**
 * States how the creation authority handled a server-resolved create command.
 *
 * {@link HistoryAnchoredConversationCreationResult} returns these values so its caller can either
 * stop without history I/O, reject a changed retry body, or hand the confirmed anchor to the
 * projection owner. The authority never converts a denial or retry conflict into a history append.
 */
export enum HistoryAnchoredConversationCreationOutcomes
{
	/** The PostgreSQL collection policy denied the creation command before history I/O. */
	Denied = "denied",
	/** The retry key already names a different request body, so the authority did not change history. */
	IdempotencyConflict = "idempotency_conflict",
	/** A confirmed revision-zero anchor awaits its separately owned PostgreSQL projection. */
	ProjectionNeeded = "projection_needed",
	/** The reservation and its durable projection had already converged before this retry arrived. */
	Projected = "projected",
}

/**
 * Requests creation from a server-resolved command without accepting a browser-created history payload.
 *
 * The reservation carries every fact that becomes part of {@link ConversationCreated}, so retry
 * recovery can reproduce revision zero without trusting another request body.
 */
export interface CreateHistoryAnchoredConversationCommand
{
	/**
	 * Supplies the command that the reservation repository must persist before KurrentDB I/O.
	 *
	 * Agent creation carries the verified identity/profile pair in `reservation.agentBinding`, which
	 * the reservation freezes with the service and revision before history I/O starts.
	 */
	readonly reservation: ReserveConversationCreationCommand;
}

/** Names the revision-zero anchor that the projection owner must rebuild from history. */
export interface ConversationCreationProjectionCommand
{
	/** Identifies the durable reservation whose state remains `HistoryAnchored` until projection converges. */
	readonly reservationId: string;
	/** Identifies the silo that owns the projection and its history stream. */
	readonly siloId: string;
	/** Identifies the conversation whose revision-zero anchor the projector must read. */
	readonly conversationId: string;
	/** Records the only history revision that can establish a conversation projection. */
	readonly historyRevision: 0n;
}

/**
	 * Requests an idempotent projection after immutable history is confirmed.
	 *
	 * The projection owner reads the revision-zero anchor itself; this creation authority never writes
	 * the relational directory, participants, or grants directly.
	 */
export interface ConversationCreationProjectionPort
{
	/**
	 * Records or runs projection work for one confirmed conversation anchor.
	 *
	 * The implementation must tolerate the same command again because a `HistoryAnchored`
	 * reservation replays this handoff after an interrupted response. It receives anchor coordinates,
	 * not directory rows or grants, so it must read revision zero before rebuilding relational state.
	 * Called by: {@link HistoryAnchoredConversationCreationAuthority.create}.
	 * @param command Identifies the reservation and its revision-zero history record.
	 * @returns Resolves after the implementation has accepted the projection work.
	 */
	request(command: ConversationCreationProjectionCommand): Promise<void>;
}

/** Applies one history record through the transaction that the projection unit of work opened. */
export interface ConversationCreationProjectionRepository
{
	/** Rebuilds directory state and advances the matching durable reservation as one transaction. */
	project(command: ConversationCreationProjectionCommand, created: ConversationCreated): Promise<void>;
}

/**
 * Opens separate serializable PostgreSQL operations on either side of KurrentDB history I/O.
 *
 * The concrete adapter builds the existing transaction-scoped reservation repository inside each
 * operation. It must never retain a Prisma transaction while this authority appends or reads
 * immutable history.
 */
export interface ConversationCreationReservationUnitOfWork
{
	/**
	 * Persists or reloads the idempotent authorization-evidenced command before history I/O.
	 *
	 * This operation finishes its PostgreSQL transaction before the authority can append to KurrentDB.
	 * Called by: {@link HistoryAnchoredConversationCreationAuthority.create}.
	 * @param command Carries server-resolved coordinates and authorization inputs to reserve.
	 * @returns The admitted command, a conflicting retry key, or an authorization denial.
	 */
	reserve(command: ReserveConversationCreationCommand): Promise<ReserveConversationCreationResult>;
	/**
	 * Recovers one caller-scoped reservation before fresh request compilation consults mutable facts.
	 *
	 * Called by: {@link HistoryAnchoredConversationCreationAuthority.resume}. It never opens a
	 * history transaction and returns `null` only when this retry key has not been admitted before.
	 */
	recover(command: RecoverConversationCreationReservationCommand): Promise<ReserveConversationCreationResult | null>;
	/**
	 * Advances an already-proven history anchor in a new serializable PostgreSQL operation.
	 *
	 * This operation runs after KurrentDB confirms revision zero, so it cannot keep a Prisma
	 * transaction open across history I/O. Called by: {@link HistoryAnchoredConversationCreationAuthority.create}.
	 * @param command Identifies the reservation whose exact creation anchor was confirmed.
	 * @returns The reservation at its stored progress state.
	 */
	markHistoryAnchored(command: AnchorConversationCreationReservationCommand): Promise<ReservedConversationCreation>;
}

/** Reports a denial, retry conflict, or the durable anchor available to the projection owner. */
export type HistoryAnchoredConversationCreationResult
	= { readonly outcome: HistoryAnchoredConversationCreationOutcomes.Denied }
	| { readonly outcome: HistoryAnchoredConversationCreationOutcomes.IdempotencyConflict }
	| { readonly outcome: HistoryAnchoredConversationCreationOutcomes.ProjectionNeeded; readonly reservation: ReservedConversationCreation; readonly created: ConversationCreated; readonly projection: ConversationCreationProjectionCommand }
	| { readonly outcome: HistoryAnchoredConversationCreationOutcomes.Projected; readonly reservation: ReservedConversationCreation; readonly created: ConversationCreated };

/** Carries the durable state used by helper functions that reconstruct the creation record. */
export interface HistoryAnchoredConversationCreationReservation extends ReservedConversationCreation
{
	/** Narrows the durable reservation state for helpers that reject unknown future values. */
	readonly state: ConversationCreationReservationStates;
}
