import type { AssembleRunInputSnapshotResult } from "@opencrane/backend/agents/execution/inputs";
import type { RunAdmissionCommit } from "@opencrane/backend/agents/execution/runs";
import type { MessageContentBlock } from "@opencrane/models/conversations";
import type { RunAdmissionCapacityGate } from "./managed-run-admission.types.js";

/** Server-derived coordinates for a personal run request after browser authentication. */
export interface PersonalRunAdmissionCommand
{
	/** ClusterTenant silo selected from the authenticated request host. */
	readonly siloId: string;
	/** Verified OIDC subject from the current browser session. */
	readonly executionSubjectId: string;
	/** Existing conversation the caller asked the server to continue. */
	readonly conversationId: string;
	/** Caller-supplied transport key that makes retries return the original snapshot. */
	readonly requestIdempotencyKey: string;
	/** Server-allocated message that must be committed with the admitted run. */
	readonly inputMessageId: string;
	/** Validated content staged until run admission can persist its message atomically. */
	readonly inputMessageBlocks: readonly MessageContentBlock[];
}

/** Durable conversation coordinates resolved before the shared capacity boundary is entered. */
export interface PersonalRunConversationAuthority
{
	/** Personal AgentService selected from the exact participant-bound conversation. */
	readonly agentServiceId: string;
}

/** Repository contract for the durable duplicate key and participant-bound personal conversation lookup. */
export interface PersonalRunAdmissionRepository
{
	/** Returns an exact duplicate result without rebuilding or modifying its frozen snapshot. */
	resolve(command: PersonalRunAdmissionCommand): Promise<PersonalRunIdempotencyResult>;
	/** Resolves the only eligible personal AgentService for a conversation participant in the caller's silo. */
	resolveConversation(command: PersonalRunAdmissionCommand): Promise<PersonalRunConversationAuthority | null>;
}

/** Transaction-scoped persistence reader constructed only inside the admission Unit of Work. */
export interface PersonalRunAdmissionReadRepository extends PersonalRunAdmissionRepository
{
}

/** Transaction owner for personal duplicate and participant-conversation authority reads. */
export interface PersonalRunAdmissionUnitOfWork extends PersonalRunAdmissionRepository
{
}

/** Stable duplicate lookup outcomes before mutable conversation eligibility is evaluated. */
export enum PersonalRunIdempotencyOutcomes
{
	/** No run has claimed this caller key in the selected silo. */
	NotFound = "not_found",
	/** The exact caller/conversation key already owns a persisted immutable snapshot. */
	Idempotent = "idempotent",
	/** The key belongs to a different subject, trigger, or conversation and cannot be reused. */
	Conflict = "conflict",
}

/** Result of checking the durable caller idempotency key. */
export type PersonalRunIdempotencyResult =
	| { readonly outcome: PersonalRunIdempotencyOutcomes.NotFound }
	| { readonly outcome: PersonalRunIdempotencyOutcomes.Idempotent; readonly runId: string }
	| { readonly outcome: PersonalRunIdempotencyOutcomes.Conflict };

/** Snapshot assembler called only after a shared admission capacity grant. */
export interface PersonalRunSnapshotAssembler
{
	/** Assembles and persists the immutable input snapshot for an already-resolved personal conversation. */
	(command: PersonalRunAdmissionCommand, authority: PersonalRunConversationAuthority, commit?: RunAdmissionCommit): Promise<AssembleRunInputSnapshotResult>;
}

/** Stable public outcome vocabulary for personal run admission. */
export enum PersonalRunAdmissionOutcomes
{
	/** A new immutable snapshot and dispatch intent were persisted. */
	Accepted = "accepted",
	/** A duplicate idempotency key returned the pre-existing immutable snapshot. */
	Idempotent = "idempotent",
	/** A trusted input, capacity slot, or durable authority was unavailable. */
	Denied = "denied",
}

/** Named local denials returned before a session assembler can supply one of its typed refusals. */
export enum PersonalRunAdmissionDenialReasons
{
	/** A caller reused an idempotency key whose durable authority coordinates differ. */
	AuthorityConflict = "authority_conflict",
	/** The active caller is no longer a participant in an active personal conversation. */
	ConversationUnavailable = "conversation_unavailable",
	/** The durable admission transaction could not complete and the caller may safely retry. */
	PersistenceUnavailable = "persistence_unavailable",
}

/** Result returned by the personal run admission port without exposing private authority detail. */
export type PersonalRunAdmissionResult =
	| { readonly outcome: PersonalRunAdmissionOutcomes.Accepted | PersonalRunAdmissionOutcomes.Idempotent; readonly runId: string }
	| { readonly outcome: PersonalRunAdmissionOutcomes.Denied; readonly reason: string };

/** Server-owned port for starting a caller's personal run from an existing conversation. */
export interface PersonalRunAdmissionPort
{
	/** Resolves the personal conversation and admits one immutable run input through the shared capacity gate. */
	admitPersonalRun(command: PersonalRunAdmissionCommand, commit?: RunAdmissionCommit): Promise<PersonalRunAdmissionResult>;
}

/** Dependencies for composing the small, transport-free personal run admission adapter. */
export interface PersonalRunAdmissionDependencies
{
	/** Durable duplicate and participant-conversation authority used only after preflight capacity grants. */
	readonly repository: PersonalRunAdmissionRepository;
	/** Immutable snapshot assembler backed by the run admission repository. */
	readonly assemble: PersonalRunSnapshotAssembler;
	/** One app-owned gate shared with managed admissions in this server process. */
	readonly capacityGate: RunAdmissionCapacityGate;
}
