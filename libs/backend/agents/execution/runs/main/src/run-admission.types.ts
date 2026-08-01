import type { Prisma } from "@prisma/client";
import type { RunInputSnapshot } from "@opencrane/contracts";
import type { AgentRevisionId, AgentRunId, AgentServiceId, SiloId, ThreadId } from "@opencrane/models/agents";

/** Immutable run, service, and revision facts accepted at the initial admission boundary. */
export interface InitialRunAuthority
{
	/** Stable AgentService executed by the logical run. */
	readonly agentServiceId: AgentServiceId;
	/** Published revision locked for the complete logical run. */
	readonly agentRevisionId: AgentRevisionId;
	/** Product boundary deciding whether an approved persona is required. */
	readonly agentKind: "personal" | "managed";
	/** Effective contract digest accepted before the runtime is eligible for dispatch. */
	readonly effectiveContractDigest: string;
	/** Version of the prompt compiler selected by the published revision. */
	readonly promptCompilerVersion: string;
	/** Trigger accepted for the initial logical run. */
	readonly trigger: "interactive" | "schedule" | "managed_invocation";
	/** Delegated user, when an interactive run acts on a human's behalf. */
	readonly delegatedUserId: string | null;
	/** Root lineage identifier fixed when the logical run is admitted. */
	readonly rootRunId: string;
	/** Immediate parent run, or null for a root admission. */
	readonly parentRunId: string | null;
}

/** Immutable coordinates shared by every initial logical-run admission. */
export interface RunAdmissionCommandCoordinates
{
	/** Caller-provided logical run identifier created before admission begins. */
	readonly runId: AgentRunId;
	/** Silo containing every authority fact and the durable run. */
	readonly siloId: SiloId;
	/** AgentService locked before any authority input is revalidated. */
	readonly agentServiceId: AgentServiceId;
	/** Conversation thread permanently bound to the admitted input snapshot, or null for non-conversational work. */
	readonly threadId: ThreadId | null;
	/** User-visible key making duplicate transport delivery return the first admission. */
	readonly requestIdempotencyKey: string;
}

/** Initial admission requested by a human whose signed membership authorises an interactive run. */
export interface UserRunAdmissionCommand extends RunAdmissionCommandCoordinates
{
	/** Discriminant that makes a human subject mandatory for a personal run. */
	readonly identityKind: "user";
	/** Interactive runs are the only root admission that exercises a human subject directly. */
	readonly trigger: "interactive";
	/** Subject that must be verified by signed fleet membership before the run can commit. */
	readonly executionSubjectId: string;
}

/** Initial admission requested for an autonomous managed AgentService. */
export interface ServiceRunAdmissionCommand extends RunAdmissionCommandCoordinates
{
	/** Discriminant that prevents a caller from supplying a user-shaped service identity. */
	readonly identityKind: "service";
	/** Managed roots are admitted by an explicit invocation or the scheduler, never interactively. */
	readonly trigger: "managed_invocation" | "schedule";
}

/** Tagged initial admission command with no untagged execution-subject fallback. */
export type RunAdmissionCommand = UserRunAdmissionCommand | ServiceRunAdmissionCommand;

/** Transaction capability supplied to every loader at the final admission fence. */
export interface RunAdmissionTransaction
{
	/** Prisma transaction through which all admission reads and durable writes must occur. */
	readonly prisma: Prisma.TransactionClient;
	/** Canonical server-owned admission time used by every fenced authority read and immutable snapshot. */
	readonly admittedAt: string;
	/** Epoch-millisecond form of the same canonical server-owned admission time. */
	readonly admittedAtEpochMs: number;
}

/** Server-side clock injected for deterministic tests without accepting a caller-controlled admission time. */
export interface RunAdmissionClock
{
	/** Returns the trusted wall-clock instant used for a newly admitted logical run. */
	now(): Date;
}

/** Ready-to-persist run facts and the single immutable snapshot assembled inside the transaction. */
export interface RunAdmissionBuild
{
	/** Authoritative initial-run facts revalidated while the service lock is held. */
	readonly authority: InitialRunAuthority;
	/** Complete immutable runtime input whose digest will be bound to the logical run. */
	readonly snapshot: RunInputSnapshot;
}

/** Callback result for a transaction-fenced admission compilation. */
export type RunAdmissionBuildResult<TDenial> = { readonly outcome: "ready"; readonly value: RunAdmissionBuild } | { readonly outcome: "denied"; readonly reason: TDenial };

/** Durable outcome of either accepting or deduplicating one logical run. */
export type RunAdmissionResult<TDenial> = { readonly outcome: "accepted" | "idempotent"; readonly snapshot: RunInputSnapshot } | { readonly outcome: "denied"; readonly reason: TDenial | "persistence_unavailable" | "authority_conflict" };

/** Run-owned boundary that serializes idempotency, final authority reads, and initial dispatch. */
export interface RunAdmissionRepository
{
	/** Resolves a duplicate before compilation or accepts one complete run/snapshot/outbox transaction. */
	admit<TDenial>(command: RunAdmissionCommand, build: (transaction: RunAdmissionTransaction) => Promise<RunAdmissionBuildResult<TDenial>>): Promise<RunAdmissionResult<TDenial>>;
}
