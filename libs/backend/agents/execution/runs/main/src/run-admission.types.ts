import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import type { RunInputSnapshot } from "@opencrane/contracts";
import type { AgentRevisionId, AgentRunId, AgentServiceId, SiloId } from "@opencrane/models/agents";
import type { ConversationId, MessageId } from "@opencrane/models/conversations";

/** The run, service, and revision facts accepted when a logical run is first admitted; they never change afterwards. */
export interface InitialRunAuthority
{
	/** Stable AgentService executed by the logical run. */
	readonly agentServiceId: AgentServiceId;
	/** Published revision frozen for the complete logical run. */
	readonly agentRevisionId: AgentRevisionId;
	/** Explicit input policy that selects persona and personal-memory treatment without inferring identity kind. */
	readonly executionPolicy: RunExecutionPolicy;
	/** Version of the prompt compiler selected by the published revision. */
	readonly promptCompilerVersion: string;
	/** Trigger accepted for the initial logical run. */
	readonly trigger: "interactive";
}

/** States whether the current immutable execution policy requires a persona revision. */
export enum RunExecutionPersonaPolicies
{
	/** The snapshot must bind one approved persona revision. */
	Required = "required",
	/** The snapshot must not select a persona revision. */
	None = "none",
}

/** States whether the current immutable execution policy permits personal-memory retrieval. */
export enum RunExecutionPersonalMemoryPolicies
{
	/** The snapshot may retrieve personal memory only through the subject's admitted policy. */
	Allowed = "allowed",
	/** The snapshot must not retrieve personal memory. */
	None = "none",
}

/**
 * Selects the persistence state of the message that triggered a conversational run.
 *
 * This stable string crosses the conversation and input-assembly packages. It requires every
 * admitted personal message to exist in Kurrent before the run transaction starts, preventing a
 * second relational copy.
 *
 * Called by: personal conversation turn admission and `__AssembleRunInputSnapshot`.
 * @see RunAdmissionMessageInput for the fields allowed by each state.
 */
export enum RunAdmissionMessageInputModes
{
	/** Durable conversation history already contains the server-verified message identifier. */
	PrePersistedHistory = "pre_persisted_history",
}

/**
 * Carries exact server-verified message provenance into snapshot assembly.
 *
 * Called by: conversation admission after durable history append.
 * @see RunAdmissionMessageInputModes for the persistence meaning of each arm.
 */
export interface RunAdmissionMessageInput
{
	/** Selects the already committed conversation-history path. */
	readonly mode: RunAdmissionMessageInputModes.PrePersistedHistory;
	/** Exact final human message that triggered admission. */
	readonly messageId: MessageId;
	/** Kurrent stream revision observed with the ordered message set. */
	readonly historyRevision: string;
	/** Canonical message order that the snapshot must preserve exactly. */
	readonly orderedMessageIds: readonly MessageId[];
	/** Immutable human author facts sealed into the durable history entry. */
	readonly author: RunAdmissionMessageAuthor;
}

/**
 * Preserves immutable human author provenance for the final Kurrent message.
 *
 * Called by: conversation history admission readers and the run persistence fence.
 * @see RunAdmissionMessageInput for the exact history boundary that carries these facts.
 */
export interface RunAdmissionMessageAuthor
{
	/** Durable local Principal that authored the triggering message. */
	readonly principalId: string;
	/** Verified OpenID Connect issuer stored with the human entry. */
	readonly issuer: string;
	/** Issuer-scoped subject stored with the human entry. */
	readonly subjectId: string;
	/** Credential authentication instant stored with the human entry. */
	readonly authenticatedAt: string;
}

/** Gives the input compiler explicit policy choices without branching on an identity class. */
export interface RunExecutionPolicy
{
	/** Selects whether the admitted snapshot requires a persona revision. */
	readonly persona: RunExecutionPersonaPolicies;
	/** Selects whether the admitted snapshot may retrieve personal memory. */
	readonly personalMemory: RunExecutionPersonalMemoryPolicies;
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
	/** Exact conversational message provenance, or null for non-conversational work. */
	readonly messageInput: RunAdmissionMessageInput | null;
}

/** Captures server-verified request provenance before the transaction resolves its durable principal. */
export interface RunAdmissionRequester
{
	/** OIDC subject from the verified browser credential. */
	readonly subjectId: string;
	/** OIDC issuer that namespaces the verified subject. */
	readonly issuer: string;
	/** Server-observed credential authentication instant. */
	readonly authenticatedAt: string;
}

/** Initial admission carries only server-derived coordinates and requester provenance. */
export interface RunAdmissionCommand extends RunAdmissionCommandCoordinates
{
	/** Trigger accepted for this new logical run. */
	readonly trigger: "interactive";
	/** Provenance from which transaction-scoped authority resolves the requester principal. */
	readonly requester: RunAdmissionRequester;
}

/** The transaction and trusted clock that every input loader uses at the final admission fence. */
export interface RunAdmissionTransaction
{
	/** Prisma transaction through which all admission reads and durable writes must occur. */
	readonly prisma: unknown;
	/** Central product authority bound to this exact admission transaction. */
	readonly authorization?: Pick<AuthorizationAuthority, "admit" | "admitPrincipal" | "admitPrincipalBatch" | "listPrincipalEntitled">;
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
	 * Another run on this conversation has not reached Completed or Failed yet, and a
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
 * Use it when a caller-owned relational row must not exist without its run. It runs last, once the
 * run and snapshot are inserted, so it may read anything admission wrote
 * and may use `value.snapshot.runId` as a foreign key. Throwing rolls the whole admission back.
 *
 * Called by: specialized admission compositions through {@link RunAdmissionRepository.admit}.
 */
export type RunAdmissionCommit = (transaction: RunAdmissionTransaction, value: RunAdmissionBuild) => Promise<void>;

/**
 * Rows the caller writes inside the admission transaction *before* the snapshot is compiled.
 *
 * Preparation runs after duplicate detection and before `build` when a specialized admission owns
 * relational authority rows that the snapshot must read in the same transaction. Personal
 * conversation messages are already durable in Kurrent and do not use this hook.
 *
 * It is skipped entirely for a duplicate request: a repeat of an already-admitted key returns the
	 * original snapshot without preparing anything, so caller-owned preparation is not repeated however
	 * many times the caller retries. If compilation then refuses, or the compiled snapshot does not
 * match the command, the transaction is rolled back and the prepared rows never commit — the caller
 * still gets the refusal as an ordinary `denied` result rather than an exception.
 *
 * Called by: specialized admission authorities that pass preparation through
 * `__AssembleRunInputSnapshot`; personal conversation admission leaves it absent.
 *
 * @see RunAdmissionCommit for the writes that belong after the run exists instead.
 */
export type RunAdmissionPrepare = (transaction: RunAdmissionTransaction) => Promise<void>;

/** Rechecks current authority before an existing snapshot may leave the admission transaction. */
export type RunAdmissionExistingVerifier<TDenial> = (snapshot: RunInputSnapshot, transaction: RunAdmissionTransaction) => Promise<{ readonly outcome: "verified" } | { readonly outcome: "denied"; readonly reason: TDenial }>;

/**
 * The single transaction in which a logical run becomes real.
 *
 * It works through a fixed order at Serializable isolation: resolves committed duplicates,
 * optionally lets the caller write the rows its own inputs need
 * ({@link RunAdmissionPrepare}), re-reads every authority input, and writes the run with its first
 * immutable snapshot. The unique request key chooses one winner, and a concurrent input
 * change makes the transaction retry instead of reaching a committed snapshot.
 *
 * Called by: `__AssembleRunInputSnapshot` in
 * `execution/inputs/main/src/session-assembly.ts`, which passes its own compile step as the
 * `build` callback. Wired by `prisma-session-assembly-authorities.ts`; implemented by
 * `PrismaRunAdmissionUnitOfWork`.
 */
export interface RunAdmissionRepository
{
	/**
	 * Admits one run, or verifies current authority before returning a previous identical request.
	 *
	 * `verifyExisting` runs inside the transaction for every committed duplicate, including unique-key
	 * race recovery, and must recheck the current authority needed to release the stored snapshot.
	 * `build` runs inside the Serializable transaction and must re-read
	 * every input it depends on rather than trusting anything read before the call. If `build`
	 * returns `denied`, the whole transaction is rolled back and nothing is written. `commit` runs
	 * last for specialized authorities that own additional relational rows. `prepare` runs before
	 * `build` for those same specialized authorities. Personal conversation messages already exist
	 * in Kurrent history, so personal admission supplies neither callback. Neither callback is
	 * replayed for a duplicate request.
	 *
	 * @param command - Run coordinates plus the `requestIdempotencyKey` that makes a repeat safe.
	 * @param verifyExisting - Rechecks current authority before releasing an existing snapshot.
	 * @param build - Called inside the transaction to compile the snapshot; its refusal aborts the
	 * admission with that reason.
	 * @param commit - Optional extra writes, run in the same transaction after the run exists.
	 * @param prepare - Optional specialized relational writes run before compilation.
	 * @returns `accepted` for a new run and `idempotent` for a repeat of one already admitted — both
	 * carry the same snapshot and both mean the caller may proceed. `denied` carries either the
	 * reason `build` gave or a {@link RunAdmissionDenialReasons} value.
	 */
	admit<TDenial>(command: RunAdmissionCommand, verifyExisting: RunAdmissionExistingVerifier<TDenial>, build: (transaction: RunAdmissionTransaction) => Promise<RunAdmissionBuildResult<TDenial>>, commit?: RunAdmissionCommit, prepare?: RunAdmissionPrepare): Promise<RunAdmissionResult<TDenial>>;
}
