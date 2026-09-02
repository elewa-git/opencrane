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

/**
 * States the outcome of reserving one server-resolved conversation creation command.
 *
 * The values cross the reservation port and determine whether history I/O may begin; only a new
 * or exact-idempotent reservation permits the history-anchored creation authority to continue.
 */
export enum ConversationCreationReservationOutcomes
{
	/** A new command and its authorization evidence committed in the reservation transaction. */
	Reserved = "reserved",
	/** The same principal, retry key, and request digest already identify a durable command. */
	Idempotent = "idempotent",
	/** The retry key identifies another request digest, so no replacement command may be stored. */
	IdempotencyConflict = "idempotency_conflict",
	/** Product authorization denied the command before a reservation or history append occurred. */
	Denied = "denied",
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

/**
 * Carries the Agent identity and profile revision frozen before an agent conversation reaches its
 * history anchor. Direct and group conversations carry no binding, while an agent conversation
 * must carry both values so a retry rebuilds the same creation payload after an ambiguous append.
 */
export interface ConversationCreationReservationAgentBinding
{
	/** Identifies the stable AgentIdentity that owns the conversation computer. */
	readonly agentIdentityId: string;
	/** Identifies the release-owned profile revision used to provision that computer. */
	readonly profileRevisionId: string;
}

/**
 * Requests the reservation transition after KurrentDB has confirmed its revision-zero creation
 * anchor. The reservation already carries its immutable Agent binding, so callers cannot alter
 * identity or profile facts after history I/O begins.
 */
export interface AnchorConversationCreationReservationCommand
{
	/** Identifies the durable command whose Kurrent creation anchor has been verified. */
	readonly reservationId: string;
}

/**
 * Requests the `Projected` transition after the directory has applied a confirmed revision-zero
 * Kurrent anchor.
 *
 * The command carries no creation data because the projection must preserve that immutable anchor;
 * retrying it returns the stored `Projected` reservation instead of advancing it again.
 * @see ConversationCreationReservationStates.Projected
 */
export interface ProjectConversationCreationReservationCommand
{
	/** Identifies the durable command whose confirmed anchor the directory has projected. */
	readonly reservationId: string;
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
	/** Carries the Agent-only identity/profile pair frozen into the initial reservation, or null otherwise. */
	readonly agentBinding: ConversationCreationReservationAgentBinding | null;
}

/** Gives callers the fixed durable command after reservation or idempotent recovery. */
export interface ReservedConversationCreation extends ReserveConversationCreationCommand
{
	/** Identifies the durable reservation row. */
	readonly reservationId: string;
	/**
	 * Records the server-owned instant at which PostgreSQL admitted the creation command.
	 *
	 * The history anchor reuses this exact value as `ConversationCreated.createdAt`, so a retry
	 * rebuilds byte-identical revision-zero payload without trusting a new request timestamp.
	 */
	readonly createdAt: string;
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
	= { readonly outcome: ConversationCreationReservationOutcomes.Reserved; readonly value: ReservedConversationCreation }
	| { readonly outcome: ConversationCreationReservationOutcomes.Idempotent; readonly value: ReservedConversationCreation }
	| { readonly outcome: ConversationCreationReservationOutcomes.IdempotencyConflict }
	| { readonly outcome: ConversationCreationReservationOutcomes.Denied };

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
	/**
	 * Advances one reservation only after its exact revision-zero anchor is present in KurrentDB.
	 *
	 * The repository validates the immutable binding fixed in the reservation and returns the
	 * already-advanced command for an exact retry. It never accepts replacement identity or profile
	 * facts after history I/O begins.
	 * @param command The durable reservation whose exact history anchor has been confirmed.
	 * @returns The anchored reservation. Matching anchored retries return the stored reservation
	 * without another update.
	 * @throws {Error} The reservation is unavailable to this caller, or its stored binding does not
	 * match its conversation mode.
	 */
	markHistoryAnchored(command: AnchorConversationCreationReservationCommand): Promise<ReservedConversationCreation>;
	/**
	 * Records that the directory and grant projections have converged from the immutable creation anchor.
	 *
	 * The repository accepts an already projected reservation as an idempotent replay, but it never
	 * advances a reserved command: KurrentDB must be confirmed before relational state can claim to
	 * represent it.
	 * @param command The durable reservation whose history-derived projection has completed.
	 * @returns The projected reservation, including an exact idempotent replay.
	 * @throws {Error} The reservation is unavailable to this caller or has no confirmed anchor.
	 */
	markProjected(command: ProjectConversationCreationReservationCommand): Promise<ReservedConversationCreation>;
}
