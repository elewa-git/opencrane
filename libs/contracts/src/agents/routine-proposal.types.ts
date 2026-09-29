import type { RoutineSchedule } from "@opencrane/models/agents";

/**
 * Durable proposal lifecycle returned by the requester API through {@link RoutineProposalReadResponse}.
 *
 * These lowercase strings are stored in `agent_routine_proposals.state`. Prisma's
 * `AgentRoutineProposalState` members use `@map` to write the same strings while retaining PascalCase
 * member names in generated code. Renaming a serialized string therefore requires coordinated
 * database and API contract changes. A state reports review progress; it does not activate a routine.
 */
export enum RoutineProposalStates
{
	/** The requester may still review and accept the suggestion. */
	Pending = "pending",
	/** The requester accepted the final reviewed command and one routine was created. */
	Accepted = "accepted",
	/** The requester or an owning workflow closed the proposal without creating a routine. */
	Cancelled = "cancelled",
	/** The database-time expiry closed the proposal before acceptance. */
	Expired = "expired",
}

/** The instruction and schedule returned to a requester for later human review. */
export interface RoutineProposalPayload
{
	/** Plaintext instruction shown to the requester for editing before acceptance. */
	readonly instruction: string;
	/** Five-field schedule shown to the requester for editing before acceptance. */
	readonly schedule: RoutineSchedule;
}

/** Browser-facing name for the immutable suggestion before human edits. */
export type RoutineProposalSuggestion = RoutineProposalPayload;

/** Shared fields returned by the requester-only routine proposal projection. */
interface RoutineProposalProjectionBase
{
	/** Opaque reference used by the requester to open or accept this proposal. */
	readonly proposalRef: string;
	/** Conversation from which the proposal was requested. */
	readonly sourceConversationId: string;
	/** Immutable model suggestion; the accepted command may contain edited values. */
	readonly suggestion: RoutineProposalSuggestion;
	/** UTC instant after which acceptance is refused. */
	readonly expiresAt: string;
}

/** A proposal that has not reached a terminal state and has no routine result. */
export interface RoutineProposalPendingProjection extends RoutineProposalProjectionBase
{
	/** The proposal remains available for requester review. */
	readonly state: RoutineProposalStates.Pending;
}

/** A proposal accepted through the existing human-reviewed routine creation command. */
export interface RoutineProposalAcceptedProjection extends RoutineProposalProjectionBase
{
	/** The proposal was accepted and is permanently linked to its created routine. */
	readonly state: RoutineProposalStates.Accepted;
	/** Routine created by the accepted final command. */
	readonly acceptedRoutineId: string;
}

/** A proposal closed without creating a routine. */
export interface RoutineProposalClosedProjection extends RoutineProposalProjectionBase
{
	/** The terminal close reason that did not create a routine. */
	readonly state: RoutineProposalStates.Cancelled | RoutineProposalStates.Expired;
}

/** Safe requester-only routine proposal projection returned after current access checks. */
export type RoutineProposalReadResponse = RoutineProposalPendingProjection | RoutineProposalAcceptedProjection | RoutineProposalClosedProjection;
