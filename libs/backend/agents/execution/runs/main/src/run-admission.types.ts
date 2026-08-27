import type { Prisma } from "@prisma/client";
import type { RunInputSnapshot } from "@opencrane/contracts";
import type { AgentRevisionId, AgentRunId, AgentServiceId, AgentServiceKind, SiloId } from "@opencrane/models/agents";
import type { ConversationId, MessageContentBlock, MessageId } from "@opencrane/models/conversations";

/** The run, service, and revision facts accepted when a logical run is first admitted; they never change afterwards. */
export interface InitialRunAuthority
{
	/** Stable AgentService executed by the logical run. */
	readonly agentServiceId: AgentServiceId;
	/** Published revision frozen for the complete logical run. */
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
	/** AgentService re-read with every other input in the admission transaction. */
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
	/** Verified OIDC issuer that namespaces the execution subject. */
	readonly executionIssuer: string;
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

/**
 * What the caller's compile step hands back from inside the admission transaction.
 *
 * `ready` means every input re-read cleanly and the run may be written. `denied` aborts the
 * admission: nothing is written, the transaction is rolled back, and the caller's own `reason` is
 * returned to it unchanged as the `TDenial` arm of {@link RunAdmissionResult}. That is how a refusal
 * from an input loader — a closed conversation, a missing persona — reaches the caller without the
 * repository having to understand it.
 */
export type RunAdmissionBuildResult<TDenial> = { readonly outcome: "ready"; readonly value: RunAdmissionBuild } | { readonly outcome: "denied"; readonly reason: TDenial };

/**
 * Why a run could not be created, and what the caller must do about each.
 *
 * These say "no run exists" rather than "one input was unavailable" — with one exception worth
 * knowing: `ActiveRun` is also returned by the conversation input loader
 * (`PrismaConversationContextRepository`) and by the personal-admission recovery read, not only by the
 * admission transaction. They travel further than this package: the values are part of
 * {@link RunAdmissionResult} and of `SessionAssemblyRefusalReason`, and the conversation unit of work
 * maps them onto the HTTP denial a client finally sees. Nothing persists them, so renaming a member
 * needs no migration, but it does change what those mappers must match on.
 *
 * The three are not interchangeable, and the difference is whether a retry can ever succeed:
 *
 * - `AuthorityConflict` is permanent for this command. Nothing committed, and sending the same
 *   command again gets the same answer. Report it; only a corrected request, with a new
 *   `requestIdempotencyKey` for genuinely new work, can get past it.
 * - `ActiveRun` is permanent right now but not forever. Nothing committed. The caller must wait for
 *   the run that owns the conversation to finish and may then retry, and reusing the same key stays
 *   safe because no run was written under it.
 * - `PersistenceUnavailable` is not a refusal at all — it means the outcome is unknown, and a run may
 *   well have committed. Never show it to a user as "declined". A retry must reuse the same
 *   `requestIdempotencyKey`, so that if a run did commit it comes back as `idempotent` instead of
 *   being created a second time.
 *
 * The set is closed here, but a caller receives it widened by the `TDenial` its own `build` step can
 * return, so a reader must not assume an incoming reason is one of these three.
 *
 * @see RunAdmissionResult
 * @see SessionAssemblyRefusalReason for the wider set of refusals the assembly caller sees.
 */
export enum RunAdmissionDenialReasons
{
	/**
	 * Two different runs are laying claim to the same coordinates. Either the idempotency key is
	 * already held by a run in another silo, service, conversation or trigger, or the snapshot that
	 * was compiled does not match the command that asked for it. Nothing was written. The caller must
	 * treat the request as rejected and must not retry with this key.
	 */
	AuthorityConflict = "authority_conflict",
	/**
	 * Another run on this conversation has not reached Completed, Failed or Cancelled yet, and a
	 * conversation runs one foreground run at a time. Nothing was written and no queue was joined —
	 * the caller must wait for the other run to end and send the request again.
	 */
	ActiveRun = "active_run",
	/**
	 * The write failed in a way that cannot be classified, so whether a run committed is unknown. The
	 * caller must not report a refusal; it must retry with the same `requestIdempotencyKey`, which
	 * returns the committed run if there was one.
	 */
	PersistenceUnavailable = "persistence_unavailable",
}

/**
 * What came back from asking for a run: a new one, the one an earlier identical request already got,
 * or a refusal.
 *
 * `accepted` and `idempotent` both carry the same snapshot and both mean the caller may proceed, but
 * they are not the same event — `accepted` is the call that created the run, `idempotent` is a repeat
 * of a key already used. A caller that treats `idempotent` as `accepted` starts a second runtime for
 * one run. `denied` carries either the reason the caller's own compile step gave (`TDenial`) or one of
 * {@link RunAdmissionDenialReasons}, and only that enum tells the caller whether a retry can help.
 */
export type RunAdmissionResult<TDenial> = { readonly outcome: "accepted" | "idempotent"; readonly snapshot: RunInputSnapshot } | { readonly outcome: "denied"; readonly reason: TDenial | RunAdmissionDenialReasons };

/**
 * Extra rows the caller writes in the same transaction as the run, after the run exists.
 *
 * Use it when a row must not be able to exist without its run. The conversation caller writes the
 * user's message here, so a stored message without a run is impossible. It runs last, once the run,
 * its snapshot and its outbox events are already inserted, so it may read anything admission wrote
 * and may use `value.snapshot.runId` as a foreign key. Throwing rolls the whole admission back.
 *
 * Called by: `PrismaConversationMessageAdmissionUnitOfWork` (server/conversations/main), through
 * {@link RunAdmissionRepository.admit} and `__AssembleRunInputSnapshot`.
 */
export type RunAdmissionCommit = (transaction: RunAdmissionTransaction, value: RunAdmissionBuild) => Promise<void>;

/**
 * Rows the caller writes inside the admission transaction *before* the snapshot is compiled.
 *
 * This exists for one situation: the run's own inputs do not exist yet. A group `@agent` mention has
 * to create the child conversation, its participants and the parent message first, because the
 * conversation input loader then reads that child conversation inside the same transaction to freeze
 * the transcript. So preparation runs after duplicate detection and before `build`.
 *
 * It is skipped entirely for a duplicate request: a repeat of an already-admitted key returns the
 * original snapshot without preparing anything, so the child conversation is created once however
 * many times the browser retries. If compilation then refuses, or the compiled snapshot does not
 * match the command, the transaction is rolled back and the prepared rows never commit — the caller
 * still gets the refusal as an ordinary `denied` result rather than an exception.
 *
 * Called by: `_admitAgentThreadMessage` in
 * server/conversations/main/src/prisma-conversation-message-admission-unit-of-work.ts, passed through
 * `admitFirstAgentThreadRun` and `__AssembleRunInputSnapshot`. Ordering and rollback are pinned by
 * `prisma-run-admission-repository.test.ts` ("prepares child authority before compilation", "rolls
 * back prepared child authority when snapshot compilation denies", "does not replay preparation for
 * an existing exact run").
 *
 * @see RunAdmissionCommit for the writes that belong after the run exists instead.
 */
export type RunAdmissionPrepare = (transaction: RunAdmissionTransaction) => Promise<void>;

/**
 * The single transaction in which a logical run becomes real.
 *
 * It works through a fixed order at Serializable isolation: resolves committed duplicates,
 * optionally lets the caller write the rows its own inputs need
 * ({@link RunAdmissionPrepare}), re-reads every authority input, and writes the run, its snapshot and
 * its first dispatch outbox row. The unique request key chooses one winner, and a concurrent input
 * change makes the transaction retry instead of reaching a committed snapshot.
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
		 * `build` runs inside the Serializable transaction and must re-read
	 * every input it depends on rather than trusting anything read before the call. If `build`
	 * returns `denied`, the whole transaction is rolled back and nothing is written. `commit` runs
	 * last, in the same transaction, for callers that need extra rows written atomically with the
	 * run. `prepare` is the mirror image, for the caller whose inputs do not exist yet: it runs
	 * before `build`, and its rows are rolled back with everything else if the admission refuses.
	 * Neither callback is replayed for a duplicate request, because the duplicate is resolved and
	 * returned before either is reached.
	 *
	 * @param command - Run coordinates plus the `requestIdempotencyKey` that makes a repeat safe.
	 * @param build - Called inside the transaction to compile the snapshot; its refusal aborts the
	 * admission with that reason.
	 * @param commit - Optional extra writes, run in the same transaction after the run exists.
	 * @param prepare - Optional writes the run's own inputs depend on, run in the same transaction
	 * before compilation. Only the group `@agent` path uses it, to create the child conversation that
	 * the conversation input loader then reads. See {@link RunAdmissionPrepare}.
	 * @returns `accepted` for a new run and `idempotent` for a repeat of one already admitted — both
	 * carry the same snapshot and both mean the caller may proceed. `denied` carries either the
	 * reason `build` gave or a {@link RunAdmissionDenialReasons} value.
	 */
	admit<TDenial>(command: RunAdmissionCommand, build: (transaction: RunAdmissionTransaction) => Promise<RunAdmissionBuildResult<TDenial>>, commit?: RunAdmissionCommit, prepare?: RunAdmissionPrepare): Promise<RunAdmissionResult<TDenial>>;
}
