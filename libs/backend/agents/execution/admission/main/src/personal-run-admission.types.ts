import type { AssembleRunInputSnapshotResult } from "@opencrane/backend/agents/execution/inputs";
import type { RunAdmissionCapacityGate } from "./managed-run-admission.types.js";

/** Server-derived coordinates for a personal run request after browser authentication. */
export interface PersonalRunAdmissionCommand
{
	/** ClusterTenant silo selected from the authenticated request host. */
	readonly siloId: string;
	/** Verified OIDC subject from the current browser session. */
	readonly executionSubjectId: string;
	/** Existing conversation thread the caller asked the server to continue. */
	readonly threadId: string;
	/** Caller-supplied transport key that makes retries return the original snapshot. */
	readonly requestIdempotencyKey: string;
}

/** Durable thread coordinates resolved before the shared capacity boundary is entered. */
export interface PersonalRunThreadAuthority
{
	/** Personal AgentService selected from the exact participant-bound thread. */
	readonly agentServiceId: string;
}

/** Repository contract for the durable duplicate key and participant-bound personal thread lookup. */
export interface PersonalRunAdmissionRepository
{
	/** Returns an exact duplicate result without rebuilding or modifying its frozen snapshot. */
	resolve(command: PersonalRunAdmissionCommand): Promise<PersonalRunIdempotencyResult>;
	/** Resolves the only eligible personal AgentService for a thread participant in the caller's silo. */
	resolveThread(command: PersonalRunAdmissionCommand): Promise<PersonalRunThreadAuthority | null>;
}

/** Transaction-scoped persistence reader constructed only inside the admission Unit of Work. */
export interface PersonalRunAdmissionReadRepository extends PersonalRunAdmissionRepository
{
}

/** Transaction owner for personal duplicate and participant-thread authority reads. */
export interface PersonalRunAdmissionUnitOfWork extends PersonalRunAdmissionRepository
{
}

/** Stable duplicate lookup outcomes before mutable thread eligibility is evaluated. */
export enum PersonalRunIdempotencyOutcomes
{
	/** No run has claimed this caller key in the selected silo. */
	NotFound = "not_found",
	/** The exact caller/thread key already owns a persisted immutable snapshot. */
	Idempotent = "idempotent",
	/** The key belongs to a different subject, trigger, or thread and cannot be reused. */
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
	/** Assembles and persists the immutable input snapshot for an already-resolved personal thread. */
	(command: PersonalRunAdmissionCommand, authority: PersonalRunThreadAuthority): Promise<AssembleRunInputSnapshotResult>;
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
	/** The active caller is no longer a participant in an active personal thread. */
	ThreadUnavailable = "thread_unavailable",
	/** The durable admission transaction could not complete and the caller may safely retry. */
	PersistenceUnavailable = "persistence_unavailable",
}

/** Result returned by the personal run admission port without exposing private authority detail. */
export type PersonalRunAdmissionResult =
	| { readonly outcome: PersonalRunAdmissionOutcomes.Accepted | PersonalRunAdmissionOutcomes.Idempotent; readonly runId: string }
	| { readonly outcome: PersonalRunAdmissionOutcomes.Denied; readonly reason: string };

/** Server-owned port for starting a caller's personal run from an existing conversation thread. */
export interface PersonalRunAdmissionPort
{
	/** Resolves the personal thread and admits one immutable run input through the shared capacity gate. */
	admitPersonalRun(command: PersonalRunAdmissionCommand): Promise<PersonalRunAdmissionResult>;
}

/** Dependencies for composing the small, transport-free personal run admission adapter. */
export interface PersonalRunAdmissionDependencies
{
	/** Durable duplicate and participant-thread authority used only after preflight capacity grants. */
	readonly repository: PersonalRunAdmissionRepository;
	/** Immutable snapshot assembler backed by the run admission repository. */
	readonly assemble: PersonalRunSnapshotAssembler;
	/** One app-owned gate shared with managed admissions in this server process. */
	readonly capacityGate: RunAdmissionCapacityGate;
}
