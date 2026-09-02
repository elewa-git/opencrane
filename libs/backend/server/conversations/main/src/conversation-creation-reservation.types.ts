import { ConversationModes } from "@opencrane/models/conversations";

/**
 * States how far a stored creation command has progressed after its PostgreSQL reservation.
 *
 * The database persists these values, and the creation orchestrator must resume from the recorded
 * state after a lost response instead of issuing a second history append. `Projected` means the
 * history anchor and the PostgreSQL projection now agree; it does not authorize another create.
 */
export enum ConversationCreationReservationStates
{
	/** The command committed with authorization evidence but has no confirmed Kurrent anchor. */
	Reserved = "reserved",
	/** The immutable revision-zero anchor matches the reservation and may now rebuild the projection. */
	HistoryAnchored = "history_anchored",
	/** The PostgreSQL directory projection and durable grants converge from the confirmed history anchor. */
	Projected = "projected",
}

/** Carries one resolved participant coordinate that the immutable creation anchor must replay exactly. */
export interface ConversationCreationReservationParticipant
{
	/** Names the participant's durable user subject, resolved inside the reservation transaction. */
	readonly userId: string;
	/** Gives the one-based creation order shared by history and the fresh 0.11 projection. */
	readonly visibleFromPosition: string;
	/** Records the server time at which the participant became visible. */
	readonly joinedAt: string;
}

/** Carries the server-owned agent coordinates known before history receives a computer provision. */
export interface ConversationCreationReservationAgentCoordinates
{
	/** Identifies the active AgentService selected inside the reservation transaction. */
	readonly agentServiceId: string;
	/** Identifies the published revision selected by the checked service pointer. */
	readonly agentRevisionId: string;
	/** Names the server-generated logical computer that only the future agent anchor may provision. */
	readonly computerId: string;
	/** Supplies the server-generated event id for the computer's retriable revision-zero provision. */
	readonly computerHistoryEventId: string;
}

/** Names the complete, resolved command that a transaction stores before any history I/O. */
export interface ReserveConversationCreationCommand
{
	/** Identifies the silo derived from the authenticated request. */
	readonly siloId: string;
	/** Identifies the caller Principal that owns this idempotency namespace. */
	readonly principalId: string;
	/** Carries the browser-provided UUID that identifies one retryable create request. */
	readonly requestId: string;
	/** Carries the digest of the exact untrusted create body after canonical server parsing. */
	readonly requestDigest: `sha256:${string}`;
	/** Supplies the server-generated conversation id that no browser may select. */
	readonly conversationId: string;
	/** Supplies the server-generated revision-zero event id for the conversation stream. */
	readonly historyEventId: string;
	/** Selects the immutable conversation kind after the server has resolved request references. */
	readonly mode: ConversationModes;
	/** Lists exact initial participant coordinates in immutable replay order. */
	readonly participants: readonly ConversationCreationReservationParticipant[];
	/** Carries agent-only server coordinates, or null for direct and group conversations. */
	readonly agent: ConversationCreationReservationAgentCoordinates | null;
}

/** Gives callers the fixed durable command after reservation or idempotent recovery. */
export interface ReservedConversationCreation extends ReserveConversationCreationCommand
{
	/** Identifies the durable reservation row. */
	readonly reservationId: string;
	/** Identifies the same-transaction authorization decision that admitted the reservation. */
	readonly authorizationEvidenceId: string;
	/** States whether the command has been anchored and projected. */
	readonly state: ConversationCreationReservationStates;
}

/**
 * Describes what a reservation attempt found for the caller's retry key.
 *
 * `reserved` gives the newly admitted command to anchor, while `idempotent` gives the earlier
 * command to resume. Callers must reject `idempotency_conflict` rather than substitute its body,
 * and must not append history after `denied`.
 */
export type ReserveConversationCreationResult
	= { readonly outcome: "reserved"; readonly value: ReservedConversationCreation }
	| { readonly outcome: "idempotent"; readonly value: ReservedConversationCreation }
	| { readonly outcome: "idempotency_conflict" }
	| { readonly outcome: "denied" };

/**
 * Persists and reloads creation commands inside the caller's serializable PostgreSQL transaction.
 *
 * A caller supplies server-resolved coordinates and receives either the command it may continue,
 * an idempotency conflict, or a denial. The command exists before Kurrent I/O so a retry cannot
 * create a second conversation from the same request key.
 */
export interface ConversationCreationReservationRepository
{
	/**
	 * Returns the prior command for a matching retry key or commits a newly admitted reservation.
	 *
	 * A changed digest under the key returns `idempotency_conflict`; a denied authorization decision
	 * returns `denied` without a command. The caller must continue history work only for the returned
	 * `reserved` or `idempotent` value.
	 * @param command Server-resolved retry, history, participant, and agent coordinates.
	 * @returns The persisted command, a retry conflict, or an authorization denial.
	 */
	reserve(command: ReserveConversationCreationCommand): Promise<ReserveConversationCreationResult>;
}
