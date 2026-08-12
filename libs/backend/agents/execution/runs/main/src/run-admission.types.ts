import type { Prisma } from "@prisma/client";
import type { RunInputSnapshot } from "@opencrane/contracts";
import type { AgentRevisionId, AgentRunId, AgentServiceId, AgentServiceKind, SiloId } from "@opencrane/models/agents";
import type { ConversationId, MessageContentBlock, MessageId } from "@opencrane/models/conversations";

/** The run, service, and revision facts accepted when a logical run is first admitted; they never change afterwards. */
export interface InitialRunAuthority
{
	/** Stable AgentService executed by the logical run. */
	readonly agentServiceId: AgentServiceId;
	/** Published revision locked for the complete logical run. */
	readonly agentRevisionId: AgentRevisionId;
	/** Product boundary deciding whether an approved persona is required. */
	readonly agentKind: AgentServiceKind;
	/** Effective contract digest accepted before the runtime is eligible for dispatch. */
	readonly effectiveContractDigest: string;
	/** Version of the prompt compiler selected by the published revision. */
	readonly promptCompilerVersion: string;
	/** Trigger accepted for the initial logical run. */
	readonly trigger: "interactive" | "schedule" | "managed_invocation";
	/** The user the run is acting for, when an interactive run acts on a human's behalf. */
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
	/** AgentService whose row is locked first, before any other input is re-read. */
	readonly agentServiceId: AgentServiceId;
	/** Conversation permanently bound to the admitted input snapshot, or null for non-conversational work. */
	readonly conversationId: ConversationId | null;
	/** User-visible key making duplicate transport delivery return the first admission. */
	readonly requestIdempotencyKey: string;
	/** Server-allocated input message included in a conversational user snapshot before its atomic insert. */
	readonly inputMessageId?: MessageId;
	/** Validated participant content staged until the run row exists in the same transaction. */
	readonly inputMessageBlocks?: readonly MessageContentBlock[];
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

/** The transaction and trusted clock that every input loader uses at the final admission fence. */
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

/** The run facts and the one immutable snapshot, both assembled inside the transaction and ready to write. */
export interface RunAdmissionBuild
{
	/** Authoritative initial-run facts revalidated while the service lock is held. */
	readonly authority: InitialRunAuthority;
	/** Complete immutable runtime input whose digest will be bound to the logical run. */
	readonly snapshot: RunInputSnapshot;
}

/** Callback result for a transaction-fenced admission compilation. */
export type RunAdmissionBuildResult<TDenial> = { readonly outcome: "ready"; readonly value: RunAdmissionBuild } | { readonly outcome: "denied"; readonly reason: TDenial };

/**
 * Why the database refused to admit a run, and what the caller should do about each.
 *
 * These come from the admission transaction itself, not from any input loader, so they mean "the
 * run could not be created" rather than "an input was unavailable". The three are not
 * interchangeable: `AuthorityConflict` and `ActiveRun` are permanent for this command and must be
 * reported to the caller, while `PersistenceUnavailable` says nothing is known about whether
 * anything committed — so it must never be presented as a refusal, and a retry must reuse the
 * same `requestIdempotencyKey` so a run that did commit is returned instead of duplicated.
 *
 * @see RunAdmissionResult
 */
export enum RunAdmissionDenialReasons
{
	/** A row with the same idempotency key, or a recovered snapshot, belongs to a different run, silo, or service. */
	AuthorityConflict = "authority_conflict",
	/** Another non-terminal foreground run already owns the command's exact conversation. */
	ActiveRun = "active_run",
	/** Persistence failed without a safely classifiable durable outcome. */
	PersistenceUnavailable = "persistence_unavailable",
}

/** Durable outcome of either accepting or deduplicating one logical run. */
export type RunAdmissionResult<TDenial> = { readonly outcome: "accepted" | "idempotent"; readonly snapshot: RunInputSnapshot } | { readonly outcome: "denied"; readonly reason: TDenial | RunAdmissionDenialReasons };

/** Optional same-transaction persistence owned by the caller of initial run admission. */
export type RunAdmissionCommit = (transaction: RunAdmissionTransaction, value: RunAdmissionBuild) => Promise<void>;

/**
 * The single transaction in which a logical run becomes real.
 *
 * It does three things in order, one caller at a time for a given idempotency key: resolves
 * duplicates, re-reads every authority input while the service row is locked, and writes the run,
 * its snapshot and its first dispatch outbox row. Running them one at a time is the point — it is
 * what stops two callers with the same key from creating two runs, and what stops an input that
 * changed mid-assembly from reaching a committed snapshot.
 *
 * Called by: `__AssembleRunInputSnapshot` in
 * `execution/inputs/main/src/session-assembly.ts`, which passes its own compile step as the
 * `build` callback. Wired by `prisma-session-assembly-authorities.ts`; implemented by
 * `PrismaRunAdmissionRepository`.
 */
export interface RunAdmissionRepository
{
	/**
	 * Admits one run, or returns the run a previous identical request already admitted.
	 *
	 * `build` runs inside the transaction, with the service row already locked, and must re-read
	 * every input it depends on rather than trusting anything read before the call. If `build`
	 * returns `denied`, the whole transaction is rolled back and nothing is written. `commit` runs
	 * last, in the same transaction, for callers that need extra rows written atomically with the
	 * run.
	 *
	 * @param command - Run coordinates plus the `requestIdempotencyKey` that makes a repeat safe.
	 * @param build - Called inside the transaction to compile the snapshot; its refusal aborts the
	 * admission with that reason.
	 * @param commit - Optional extra writes, run in the same transaction after the run exists.
	 * @returns `accepted` for a new run and `idempotent` for a repeat of one already admitted — both
	 * carry the same snapshot and both mean the caller may proceed. `denied` carries either the
	 * reason `build` gave or a {@link RunAdmissionDenialReasons} value.
	 */
	admit<TDenial>(command: RunAdmissionCommand, build: (transaction: RunAdmissionTransaction) => Promise<RunAdmissionBuildResult<TDenial>>, commit?: RunAdmissionCommit): Promise<RunAdmissionResult<TDenial>>;
}
