import type { ConversationComputerContinuationReservation, ConversationComputerModelCustody, ConversationComputerToolResults, ConversationComputerToolSelection } from "./conversation-computer-continuation.types";
import type { ConversationComputerModelProgress, ConversationComputerModelReservation, ConversationComputerModelTransport } from "./conversation-computer-model.types";
import type { ConversationToolProposalAdmission } from "../tools/proposal/conversation-tool-proposal.types";
import type { AgentScope, ClaimedLeaseScope, CompiledRunInput, ComputerScope, LeaseScope } from "@opencrane/contracts";
import type { PersonalConversationExecutionSubjectCoordinates } from "@opencrane/backend/agents/execution/inputs";
import type { Logger } from "@opencrane/backend/observability";
import type { RuntimeTokenReviewer, RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";
import type { BoundConversationWriter } from "@opencrane/backend/server/conversations/history";
import type { BoundConversationWriterBinding, BoundConversationWriterIntent } from "@opencrane/backend/server/conversations/history";
import type { ConversationComputerLeaseCoordinates } from "@opencrane/backend/server/conversations/computers";
import type { ConversationComputerReviewCredentialDeriver } from "../review/conversation-computer-review.types";
import type { ConversationToolResultNotificationPort } from "./tool-result-notifications/conversation-tool-result-notification.types";

/** Coordinates a sandbox Pod must prove before receiving its review credential. */
export interface ConversationComputerPodLeaseCommand
{
	/** Identifies the logical computer fixed on the Pod label. */
	readonly computerId: string;
	/** Names the lease and generation the Pod claims from its labels; the server checks both against current history. */
	readonly lease: LeaseScope;
	/** Carries only the TokenReviewed Pod identity. */
	readonly workload: RuntimeWorkloadIdentity;
}

/** Server-owned lease coordinates that let one durable workflow select the next saved turn. */
export interface ConversationComputerTurnWorkflowCommand
{
	/** Identifies the logical computer named by the activation delivery. */
	readonly computerId: string;
	/** Names the exact active lease and generation selected by the activation authority. */
	readonly lease: LeaseScope;
	/** Identifies the human entry whose durable activation owns this workflow. */
	readonly causationId: string;
	/** Records the human entry's immutable conversation position. */
	readonly causationPosition: string;
}

/** Current turn input and live Agent Sandbox identity resolved from server-owned evidence. */
export interface ConversationComputerTurnExecution
{
	readonly candidate: ConversationComputerTurnCandidate;
	readonly workload: RuntimeWorkloadIdentity;
}

/**
 * Review gateway secret handed to the bound Pod once per lease.
 *
 * The Pod writes this value to its private credential file and the review surface accepts only this
 * bearer. The server derives the same value for the review proxy and for checkpoint transport, so
 * nothing is stored and the secret dies with the lease.
 */
export interface ConversationComputerReviewCredentialGrant
{
	/** Keyed HMAC over the lease coordinates; it is never a label, an env var or a log field. */
	readonly reviewCredential: string;
}

/** Carries the validated server model response into encrypted, lease-fenced output preparation. */
export interface ConversationComputerOutputCommand
{
	/** Binds output to the exact admitted bootstrap. */
	readonly bootstrapId: string;
	/** UUID idempotency key derived from the winning model reservation. */
	readonly sourceCommandId: string;
	/** Carries the reservation fence retained by the live server handler; it is not a Pod credential. */
	readonly modelInvocationFence: string;
	/** Retains any shorter authority deadline observed immediately before gateway dispatch. */
	readonly modelNotAfterEpochMs: number;
	/** Plain assistant text accepted only into encrypted private payload storage. */
	readonly text: string;
}

/** Product authority shared by the lease-fenced review credential route and durable server workflow. */
export interface ConversationComputerTurnAuthority
{
	/** Return the review gateway secret after current lease and Pod checks, without admitting a run. */
	reviewCredential(command: ConversationComputerPodLeaseCommand): Promise<ConversationComputerReviewCredentialGrant>;
	/** Freeze or recover the next turn selected by one durable activation workflow. */
	start(command: ConversationComputerTurnWorkflowCommand): Promise<FrozenConversationComputerTurn | null>;
	/** Advance one saved server-owned turn without accepting Pod-supplied model authority. */
	advance(turnId: string): Promise<ConversationComputerModelProgress>;
}

/** Server-resolved coordinates shared by a freshly compiled candidate and its frozen record. */
export interface ConversationComputerTurnCoordinates
{
	/** Fixes the stream, run and agent author the bound writer may use for this turn. */
	readonly binding: BoundConversationWriterBinding;
	/** Pending human entry the turn answers; it also anchors the deterministic bootstrap identifier. */
	readonly latestPendingEntryId: string;
	/** Records the pending human entry's immutable conversation position. */
	readonly latestPendingEntryPosition: string;
	/** Names the one model alias the attempt credential may call. */
	readonly modelAlias: string;
	/** Caps the attempt credential's spend in US dollars. */
	readonly maximumBudgetUsd: number;
	/** Caps each credential issuance; fresh authority and lease expiry can shorten it further. */
	readonly credentialLifetimeSeconds: number;
	/** Names the lease, generation and SandboxClaim the turn was compiled for. */
	readonly lease: ClaimedLeaseScope;
}

/** Server-resolved material used to freeze one pending computer turn; only the authority holds the compiled input. */
export interface ConversationComputerTurnCandidate extends ConversationComputerTurnCoordinates
{
	/** Compiled from the admitted run input snapshot; it never enters an immutable event. */
	readonly compiledInput: CompiledRunInput;
	/** Absolute limit recomputed from the frozen run authority and shortened to its current lease. */
	readonly credentialExpiresAt: string;
}

/**
 * Coordinates that let the server recompile one turn and prove the result matches the frozen record.
 *
 * The run input snapshot in PostgreSQL keeps the message references, and the compiler re-reads the
 * exact encrypted revisions, so these fields plus the digest are enough to rebuild the compiled input.
 */
export interface ConversationComputerTurnCompileAnchor
{
	/** Run whose first attempt snapshot the turn was compiled from. */
	readonly runId: string;
	/** Attempt number of that snapshot. */
	readonly attempt: number;
	/** Prompt compiler version that produced the frozen digest. */
	readonly promptCompilerVersion: string;
	/** Digest of the compiled input, written as `sha256:<hex>`; a recompile must reproduce it byte for byte. */
	readonly digest: string;
}

/**
 * Durable turn record; it carries only coordinates and a digest, never compiled content or a raw LiteLLM credential.
 *
 * The Kurrent event stores the lease flat (`generation`, `leaseId`, `sandboxClaimId`); the turn store
 * maps between that persisted shape and the `lease` bundle here. The record is assignable to
 * `ConversationComputerLeaseCoordinates`, so the active-turn stream can be derived from it directly.
 */
export interface FrozenConversationComputerTurn extends ConversationComputerTurnCoordinates
{
	/** Stable idempotency coordinate derived from the silo, lease and pending entry. */
	readonly bootstrapId: string;
	/** Identifies the silo fixed by server configuration when the turn was frozen. */
	readonly siloId: string;
	/** Identifies the logical computer the Pod named on its label. */
	readonly computerId: string;
	/** Requires the server's recompiled input to match before model dispatch. */
	readonly compile: ConversationComputerTurnCompileAnchor;
	/** Source command of the accepted output, or null while the turn is still open. */
	readonly outputSourceCommandId: string | null;
	/** Receipt of the durable output, or null while the turn is still open. */
	readonly outputReceipt: ConversationComputerTurnOutputReceipt | null;
	/** Records the Stop command that won this turn's terminal revision, or null while output may still win. */
	readonly cancellationReceipt: ConversationComputerTurnCancellationReceipt | null;
	/** Identifies the saved model-selected tool; unresolved work cannot produce final output. */
	readonly toolSelection: ConversationComputerToolSelection | null;
	/** Consumes the second and final model allowance after the exact tool result is saved. */
	readonly continuationReservation: ConversationComputerContinuationReservation | null;
	/** Consumes the first model allowance across retries and process restarts. */
	readonly modelReservation: ConversationComputerModelReservation | null;
}

/** Minimal terminal decision retained in the turn stream when Stop wins against final output. */
export interface ConversationComputerTurnCancellationReceipt
{
	/** Identifies the durable Stop control event. */
	readonly commandId: string;
	/** Binds the exact SQL-admitted command, target and original workflow receipt. */
	readonly commandDigest: string;
	/** Preserves the database-owned admission time across Kurrent retries. */
	readonly occurredAt: string;
}

/** Keeps the complete server-stamped output intent in the existing durable turn decision. */
export type ConversationComputerTurnOutputReceipt = BoundConversationWriterIntent;

/** Returns the stored winning intent, whose timestamp may differ from a concurrent preparation. */
export interface ConversationComputerOutputDecision
{
	/** Reports whether this call newly recorded the decision or recovered an existing winner. */
	readonly outcome: "accepted" | "idempotent";
	/** Retains the exact stored envelope that completion must append or recognize. */
	readonly receipt: ConversationComputerTurnOutputReceipt;
}

/** Resolves only a currently active, Pod-bound computer and its next pending input. */
export interface ConversationComputerTurnCandidateResolver
{
	/** Throw unless the command names the current active lease and the TokenReviewed Pod bound to it; admit nothing. */
	admit(command: ConversationComputerPodLeaseCommand): Promise<void>;
	resolve(command: ConversationComputerPodLeaseCommand): Promise<ConversationComputerTurnCandidate | null>;
	/** Resolve a candidate and its live Pod identity without accepting a Pod request as authority. */
	resolveForWorkflow(command: ConversationComputerTurnWorkflowCommand): Promise<ConversationComputerTurnExecution | null>;
	/** Return the current recompiled candidate only when it still matches the frozen turn. */
	assertCurrent(turn: FrozenConversationComputerTurn, workload: RuntimeWorkloadIdentity): Promise<ConversationComputerTurnCandidate>;
	/** Recheck the current candidate and live Pod identity for a server-owned workflow effect. */
	assertCurrentForWorkflow(turn: FrozenConversationComputerTurn): Promise<ConversationComputerTurnExecution>;
	/** Recheck only the live lease and Pod after output acceptance has changed conversation history. */
	assertLeaseForWorkflow(turn: FrozenConversationComputerTurn): Promise<RuntimeWorkloadIdentity>;
}

/** Locates immutable computer coordinates from the workload's reviewed silo. */
export interface ConversationComputerTurnProjectionRepository
{
	resolve(siloId: string, computerId: string): Promise<{ readonly conversationId: string; readonly agentIdentityId: string; readonly profileRevisionId: string } | null>;
}

/** Server-resolved computer, profile and lease a pending turn is compiled for. */
export interface ConversationComputerTurnCompileCommand
{
	/** Names the computer and the conversation and agent identity it belongs to. */
	readonly computer: ComputerScope;
	/** Identifies the immutable profile revision bound to the computer. */
	readonly profileRevisionId: string;
	/** Names the active lease, generation and SandboxClaim the Pod proved. */
	readonly lease: ClaimedLeaseScope;
}

/** Selects the exact history prefix that produced one already frozen turn. */
export interface ConversationComputerTurnHistoryAnchor
{
	readonly expectedRevision: bigint;
	readonly latestPendingEntryId: string;
}

/** Compiles pending history and the service's current published revision for a new frozen turn. */
export interface ConversationComputerPendingTurnCompiler
{
	/** Returns the compiled candidate, or null when no human entry is waiting for the agent. */
	compile(command: ConversationComputerTurnCompileCommand, anchor?: ConversationComputerTurnHistoryAnchor): Promise<ConversationComputerTurnCandidate | null>;
}

/** Identifies the canonical Kurrent history already persisted before run admission. */
export interface ConversationComputerPrePersistedMessageInput
{
	/** Selects the history-owned input path. */
	readonly mode: "pre_persisted_history";
	/** Identifies the exact pending immutable human message. */
	readonly messageId: string;
	/** Records the Kurrent stream revision observed with the ordered message set. */
	readonly historyRevision: string;
	/** Preserves canonical message order for the admission snapshot. */
	readonly orderedMessageIds: readonly string[];
}

/** Server-resolved authority facts passed to the application-owned run admission composition. */
export interface ConversationComputerRunAdmissionCommand extends PersonalConversationExecutionSubjectCoordinates
{
	/** Selects the already persisted Kurrent entry without asking run admission to write it again. */
	readonly messageInput: ConversationComputerPrePersistedMessageInput;
}

/** Application-supplied boundary that atomically admits and compiles one immutable run input. */
export interface ConversationComputerRunAdmissionPort
{
	/** Admit only the server-resolved command; rejection must fail instead of producing an untracked turn. */
	admit(command: ConversationComputerRunAdmissionCommand): Promise<{ readonly compiledInput: CompiledRunInput; readonly authorityExpiresAt: string }>;
}

/** Owns idempotent Kurrent-backed turn freezing and output completion state. */
export interface ConversationComputerTurnStore
{
	/** Creates the deterministic turn stream or returns the byte-equivalent frozen turn already stored. */
	createOrRead(turn: FrozenConversationComputerTurn): Promise<FrozenConversationComputerTurn>;
	/** Loads the frozen record and its output receipt, or null when no turn has this bootstrap id. */
	load(bootstrapId: string): Promise<FrozenConversationComputerTurn | null>;
	/** Loads the unsettled turn on this lease, or null when the lease has no open turn. */
	loadActive(command: ConversationComputerLeaseCoordinates): Promise<FrozenConversationComputerTurn | null>;
	/** Appends the output receipt, or recognizes the same receipt on an uncertain retry. */
	markOutput(bootstrapId: string, receipt: ConversationComputerTurnOutputReceipt): Promise<ConversationComputerOutputDecision>;
	/** Reserves a proposal against the same turn revision as model dispatch, before database admission. */
	selectTool(bootstrapId: string, selection: ConversationComputerToolSelection): Promise<void>;
	/** Reserve the final request after exact result custody; only the live winner may send. */
	reserveContinuation(bootstrapId: string, reservation: ConversationComputerContinuationReservation): Promise<boolean>;
	/** Return true only when this call stored and read back its fresh model fence; false never permits dispatch. */
	reserveModel(bootstrapId: string, reservation: ConversationComputerModelReservation): Promise<boolean>;
	/** Releases the lease's active-turn pointer after run completion and credential revocation. */
	settle(turn: FrozenConversationComputerTurn): Promise<void>;
}

/** Attempt-scoped model credential request, fenced to the computer and lease that will use it. */
export interface ConversationComputerCredentialIssueCommand
{
	/** Binds the credential to one admitted bootstrap so a retry returns the same key. */
	readonly bootstrapId: string;
	/** Names the computer and conversation whose active-lease row must still exist. */
	readonly computer: ComputerScope;
	/** Names the lease the active-lease row must still carry. */
	readonly lease: LeaseScope;
	/** Provider-side alias under which the key is minted and later revoked. */
	readonly keyAlias: string;
	/** Sole model alias the key may call. */
	readonly modelAlias: string;
	/** Spend cap in US dollars for this attempt. */
	readonly maxBudgetUsd: number;
	/** Maximum requested lifetime in seconds, also bounded by the absolute notAfter limit. */
	readonly expirySeconds: number;
	/** Absolute authority and lease limit; retries cannot restart this clock. */
	readonly notAfter: string;
}

/** Returns server-held key material and the receipt a later workflow pass must match. */
export interface ConversationComputerCredentialReceipt
{
	/** Carries the raw key in server memory; never persist it in the turn stream. */
	readonly key: string;
	/** Binds a later step to the same issued key. */
	readonly credentialDigest: string;
	/** Preserves the actual provider-reported expiry rather than a newly calculated lifetime. */
	readonly expiresAt: string;
}

/**
 * Requires existing custody to match the first accepted model response's credential receipt.
 * Supply the original issue coordinates and authority limit; reuse ignores the relative lifetime
 * and never resets the spend ceiling or actual key expiry.
 */
export interface ConversationComputerCredentialReuseCommand extends ConversationComputerCredentialIssueCommand
{
	/** Requires the digest saved with the accepted response; a replacement key is refused. */
	readonly expectedCredentialDigest: string;
	/** Requires the actual expiry saved with that digest; reuse never renews this deadline. */
	readonly expectedExpiresAt: string;
}

/** Keeps one attempt key across model requests without replacing spent or uncertain custody. */
export interface ConversationComputerCredentialIssuer
{
	/** Mint for the live first-reservation owner or recover its usable custody; refusal never grants another dispatch. */
	issueOnce(input: ConversationComputerCredentialIssueCommand): Promise<ConversationComputerCredentialReceipt>;
	/** Read the same unexpired key under current lease authority; missing or mismatched custody never mints a key. */
	reuseExact(input: ConversationComputerCredentialReuseCommand): Promise<ConversationComputerCredentialReceipt>;
	/** Revoke and clear secret custody while retaining the spent attempt marker. */
	revoke(bootstrapId: string): Promise<void>;
}

/** Persists assistant text as an encrypted payload and returns its non-secret message block reference. */
export interface ConversationComputerOutputPayloadStore
{
	store(turn: FrozenConversationComputerTurn, sourceCommandId: string, text: string): Promise<{ readonly blockId: string; readonly payloadRef: string; readonly ciphertextDigest: string }>;
}

/** Creates the single-use writer whose binding was frozen with the bootstrap. */
export interface ConversationComputerBoundWriterFactory
{
	create(turn: FrozenConversationComputerTurn, workload: RuntimeWorkloadIdentity): Pick<BoundConversationWriter, "prepare" | "confirm">;
}

/** Dependencies of the durable computer-turn product authority. */
export interface ConversationComputerTurnAuthorityDependencies
{
	readonly siloId: string;
	readonly candidates: ConversationComputerTurnCandidateResolver;
	readonly credentials: ConversationComputerCredentialIssuer;
	readonly endpoint: string;
	/** Performs one request; credentials remain behind this server-only port. */
	readonly model: ConversationComputerModelTransport;
	/** Keeps accepted tool declarations and result pairs encrypted until the turn refers to them. */
	readonly modelCustody: ConversationComputerModelCustody;
	/** Reads and acknowledges the exact original tool result under current authority. */
	readonly toolResults: ConversationComputerToolResults;
	/** Keeps a safe terminal result in participant history before spending the final model call. */
	readonly toolResultNotifications: ConversationToolResultNotificationPort;
	/** Receives closed diagnostics only, never prompts, keys or provider response data. */
	readonly logger: Pick<Logger, "warn">;
	/** Derives the review gateway secret under the server-only key. */
	readonly reviewCredentials: ConversationComputerReviewCredentialDeriver;
	readonly outputPayloads: ConversationComputerOutputPayloadStore;
	readonly store: ConversationComputerTurnStore;
	readonly writers: ConversationComputerBoundWriterFactory;
	readonly runLifecycle: ConversationComputerRunLifecycle;
	/** Owns one stable proposal slot and its current transactional admission. */
	readonly toolProposals: ConversationToolProposalAdmission;
}

/** Run, attempt and lease fence a run lifecycle transition must match against the saved execution subject. */
export interface ConversationComputerRunLifecycleCommand
{
	/** Run whose lifecycle may advance. */
	readonly runId: string;
	/** Silo that owns the run. */
	readonly siloId: string;
	/** Attempt recorded in the run's execution subject. */
	readonly attempt: number;
	/** Computer admitted for this attempt. */
	readonly computerId: string;
	/** Lease and generation admitted for this attempt. */
	readonly lease: LeaseScope;
}

/** Advances the exact admitted run after durable turn milestones. */
export interface ConversationComputerRunLifecycle
{
	/** Records that bootstrap reached the admitted computer and the run may execute. */
	start(command: ConversationComputerRunLifecycleCommand): Promise<void>;
	/** Records success after the assistant output and its receipt are durable. */
	complete(command: ConversationComputerRunLifecycleCommand): Promise<void>;
}

/** Mints and revokes raw provider-gateway keys behind encrypted retry custody. */
export interface ConversationComputerRawCredentialAuthority
{
	issue(input: { readonly keyAlias: string; readonly modelAlias: string; readonly maxBudgetUsd: number; readonly expirySeconds: number; readonly notAfter: string }): Promise<{ readonly key: string; readonly expiresAt: string }>;
	revoke(input: { readonly keyAlias: string; readonly key: string }): Promise<void>;
	revokeByAlias(input: { readonly keyAlias: string }): Promise<void>;
}

/** Dependencies fixed before the private conversation-computer router is mounted. */
export interface ConversationComputerReviewCredentialRouterOptions
{
	/** Records the fixed operation and sanitized diagnostic when authority rejects a request; never receives request or credential data. */
	readonly logger: Pick<Logger, "warn">;
	/** TokenReviews the exact audience, namespace, ServiceAccount and bound Pod UID. */
	readonly tokenReviewer: RuntimeTokenReviewer;
	/** Owns durable lease, input, model credential and output authority. */
	readonly authority: ConversationComputerTurnAuthority;
}

/** Supplies only the current checks needed immediately before a physical answer append. */
export interface ConversationComputerAnswerAuthorityDependencies
{
	readonly candidates: Pick<ConversationComputerTurnCandidateResolver, "assertCurrent">;
	readonly toolResults: Pick<ConversationComputerToolResults, "read">;
}
