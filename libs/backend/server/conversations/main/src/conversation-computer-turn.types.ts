import type { CompiledRunInput } from "@opencrane/contracts";
import type { RuntimeTokenReviewer, RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";
import type { BoundConversationWriter } from "./bound-conversation-writer";
import type { BoundConversationWriterBinding } from "./bound-conversation-writer.types";

/** Coordinates a sandbox Pod must prove before receiving one pending turn. */
export interface ConversationComputerBootstrapCommand
{
	/** Identifies the logical computer fixed on the Pod label. */
	readonly computerId: string;
	/** Fences the current realization. */
	readonly generation: number;
	/** Identifies the sole current lease. */
	readonly leaseId: string;
	/** Carries only the TokenReviewed Pod identity. */
	readonly workload: RuntimeWorkloadIdentity;
}

/** Attempt-scoped model credential returned only to its currently bound Pod. */
export interface ConversationComputerModelCredential
{
	/** Private OpenAI-compatible LiteLLM endpoint. */
	readonly endpoint: string;
	/** Short-lived virtual key; it is never logged or persisted in conversation history. */
	readonly key: string;
	/** Sole public model alias admitted for this turn. */
	readonly model: string;
}

/** One immutable turn envelope returned after identity and lease admission. */
export interface ConversationComputerBootstrap
{
	/** Stable idempotency coordinate for bootstrap and output retry. */
	readonly bootstrapId: string;
	/** Recompiled input for this attempt, proven equal to the frozen digest; it travels only over the private transport. */
	readonly compiledInput: CompiledRunInput;
	/** Bounded route minted for only this attempt. */
	readonly modelCredential: ConversationComputerModelCredential;
	/** States that this Pod may execute the returned turn. */
	readonly outcome: "ready";
}

/** Carries untrusted computer output that still requires server stamping, encryption, and lease fencing. */
export interface ConversationComputerOutputCommand
{
	/** Binds output to the exact admitted bootstrap. */
	readonly bootstrapId: string;
	/** UUID idempotency key reused for uncertain retries. */
	readonly sourceCommandId: string;
	/** Plain assistant text accepted only into encrypted private payload storage. */
	readonly text: string;
	/** Carries only the TokenReviewed Pod identity. */
	readonly workload: RuntimeWorkloadIdentity;
}

/** Product authority behind the private transport. */
export interface ConversationComputerTurnAuthority
{
	/** Return the next pending turn or null while no work is admitted. */
	bootstrap(command: ConversationComputerBootstrapCommand): Promise<ConversationComputerBootstrap | null>;
	/** Append untrusted output through the bootstrap-bound conversation writer and encrypted payload store. */
	appendOutput(command: ConversationComputerOutputCommand): Promise<"accepted" | "idempotent">;
}

/** Server-resolved coordinates shared by a freshly compiled candidate and its frozen record. */
export interface ConversationComputerTurnCoordinates
{
	readonly binding: BoundConversationWriterBinding;
	/** Pending human entry the turn answers; it also anchors the deterministic bootstrap identifier. */
	readonly latestPendingEntryId: string;
	readonly modelAlias: string;
	readonly maximumBudgetUsd: number;
	readonly credentialLifetimeSeconds: number;
	readonly sandboxClaimId: string;
}

/** Server-resolved material used to freeze one pending computer turn; only the authority holds the compiled input. */
export interface ConversationComputerTurnCandidate extends ConversationComputerTurnCoordinates
{
	/** Compiled from the admitted run input snapshot; it never enters an immutable event. */
	readonly compiledInput: CompiledRunInput;
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

/** Durable turn record; it carries only coordinates and a digest, never compiled content or a raw LiteLLM credential. */
export interface FrozenConversationComputerTurn extends ConversationComputerTurnCoordinates
{
	readonly bootstrapId: string;
	readonly computerId: string;
	readonly generation: number;
	readonly leaseId: string;
	readonly siloId: string;
	/** Recompile anchor checked against every fresh compile before the Pod receives input. */
	readonly compile: ConversationComputerTurnCompileAnchor;
	readonly outputSourceCommandId: string | null;
	readonly outputReceipt: ConversationComputerTurnOutputReceipt | null;
}

/** Durable material that lets a restarted worker finish an output without retaining plaintext. */
export interface ConversationComputerTurnOutputReceipt
{
	readonly sourceCommandId: string;
	readonly blockId: string;
	readonly payloadRef: string;
	readonly ciphertextDigest: string;
}

/** Resolves only a currently active, Pod-bound computer and its next pending input. */
export interface ConversationComputerTurnCandidateResolver
{
	resolve(command: ConversationComputerBootstrapCommand): Promise<ConversationComputerTurnCandidate | null>;
	assertCurrent(turn: FrozenConversationComputerTurn, workload: RuntimeWorkloadIdentity): Promise<void>;
}

/** Locates immutable computer coordinates from the workload's reviewed silo. */
export interface ConversationComputerTurnProjectionRepository
{
	resolve(siloId: string, computerId: string): Promise<{ readonly conversationId: string; readonly agentIdentityId: string; readonly profileRevisionId: string } | null>;
}

/** Verifies the TokenReviewed Pod against the exact SandboxClaim and copied lease labels. */
export interface ConversationComputerPodBindingVerifier
{
	verify(command: { readonly computerId: string; readonly generation: number; readonly leaseId: string; readonly sandboxClaimId: string; readonly workload: RuntimeWorkloadIdentity }): Promise<boolean>;
}

/** Compiles pending history and the service's current published revision for a new frozen turn. */
export interface ConversationComputerPendingTurnCompiler
{
	compile(command: { readonly siloId: string; readonly computerId: string; readonly conversationId: string; readonly agentIdentityId: string; readonly profileRevisionId: string; readonly generation: number; readonly leaseId: string; readonly sandboxClaimId: string }): Promise<ConversationComputerTurnCandidate | null>;
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
export interface ConversationComputerRunAdmissionCommand
{
	/** Stable logical run identifier derived from the pending immutable entry. */
	readonly runId: string;
	/** Product silo fixed by trusted server configuration. */
	readonly siloId: string;
	/** Conversation selected by the verified active computer projection. */
	readonly conversationId: string;
	/** Agent service bound immutably to the conversation. */
	readonly agentServiceId: string;
	/** Published agent revision observed in the participant-authorized transaction. */
	readonly agentRevisionId: string;
	/** Agent identity fixed by the active computer history. */
	readonly agentIdentityId: string;
	/** Profile revision fixed by the active computer history. */
	readonly profileRevisionId: string;
	/** Principal stamped on the pending human entry and rechecked against current membership and Use authority. */
	readonly requesterPrincipalId: string;
	/** Issuer loaded from that exact durable Principal rather than accepted from the computer. */
	readonly requesterIssuer: string;
	/** Subject loaded from that exact durable Principal rather than accepted from the computer. */
	readonly requesterSubjectId: string;
	/** Verified credential authentication instant preserved on the immutable human author. */
	readonly requesterAuthenticatedAt: string;
	/** Immutable pending entry used as the admission idempotency coordinate. */
	readonly requestIdempotencyKey: string;
	/** Selects the already persisted Kurrent entry without asking run admission to write it again. */
	readonly messageInput: ConversationComputerPrePersistedMessageInput;
	/** Logical computer proven active by current Kurrent history. */
	readonly computerId: string;
	/** Active lease proven by current Kurrent history. */
	readonly leaseId: string;
	/** Lease generation copied from the verified current computer state. */
	readonly leaseGeneration: number;
	/** SandboxClaim whose Pod binding passed the infrastructure verifier. */
	readonly sandboxClaimId: string;
}

/** Application-supplied boundary that atomically admits and compiles one immutable run input. */
export interface ConversationComputerRunAdmissionPort
{
	/** Admit only the server-resolved command; rejection must fail instead of producing an untracked turn. */
	admit(command: ConversationComputerRunAdmissionCommand): Promise<CompiledRunInput>;
}

/** Owns idempotent Kurrent-backed turn freezing and output completion state. */
export interface ConversationComputerTurnStore
{
	createOrRead(turn: FrozenConversationComputerTurn): Promise<FrozenConversationComputerTurn>;
	load(bootstrapId: string): Promise<FrozenConversationComputerTurn | null>;
	loadActive(command: Pick<ConversationComputerBootstrapCommand, "computerId" | "generation" | "leaseId"> & { readonly siloId: string }): Promise<FrozenConversationComputerTurn | null>;
	markOutput(bootstrapId: string, receipt: ConversationComputerTurnOutputReceipt): Promise<"accepted" | "idempotent">;
	settle(turn: FrozenConversationComputerTurn): Promise<void>;
}

/** Mints a short-lived virtual key restricted to one model alias and attempt budget. */
export interface ConversationComputerCredentialIssuer
{
	/** Atomically return the current credential or revoke it before installing a replacement. */
	issueOrRotate(input: { readonly bootstrapId: string; readonly siloId: string; readonly conversationId: string; readonly computerId: string; readonly leaseId: string; readonly leaseGeneration: number; readonly keyAlias: string; readonly modelAlias: string; readonly maxBudgetUsd: number; readonly expirySeconds: number }): Promise<{ readonly key: string; readonly credentialDigest: string }>;
	/** Revoke and forget the attempt credential after terminal output. */
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
	create(turn: FrozenConversationComputerTurn, workload: RuntimeWorkloadIdentity): Pick<BoundConversationWriter, "append">;
}

/** Dependencies of the durable computer-turn product authority. */
export interface ConversationComputerTurnAuthorityDependencies
{
	readonly siloId: string;
	readonly candidates: ConversationComputerTurnCandidateResolver;
	readonly credentials: ConversationComputerCredentialIssuer;
	readonly endpoint: string;
	readonly outputPayloads: ConversationComputerOutputPayloadStore;
	readonly store: ConversationComputerTurnStore;
	readonly writers: ConversationComputerBoundWriterFactory;
	readonly runLifecycle: ConversationComputerRunLifecycle;
}

/** Advances the exact admitted run after durable turn milestones. */
export interface ConversationComputerRunLifecycle
{
	start(command: { readonly runId: string; readonly siloId: string; readonly attempt: number; readonly computerId: string; readonly leaseId: string; readonly leaseGeneration: number }): Promise<void>;
	complete(command: { readonly runId: string; readonly siloId: string; readonly attempt: number; readonly computerId: string; readonly leaseId: string; readonly leaseGeneration: number }): Promise<void>;
}

/** Mints and revokes raw provider-gateway keys behind encrypted retry custody. */
export interface ConversationComputerRawCredentialAuthority
{
	issue(input: { readonly keyAlias: string; readonly modelAlias: string; readonly maxBudgetUsd: number; readonly expirySeconds: number }): Promise<{ readonly key: string }>;
	revoke(input: { readonly keyAlias: string; readonly key: string }): Promise<void>;
	revokeByAlias(input: { readonly keyAlias: string }): Promise<void>;
}

/** Dependencies fixed before the private conversation-computer router is mounted. */
export interface ConversationComputerTurnRouterOptions
{
	/** TokenReviews the exact audience, namespace, ServiceAccount and bound Pod UID. */
	readonly tokenReviewer: RuntimeTokenReviewer;
	/** Owns durable lease, input, model credential and output authority. */
	readonly authority: ConversationComputerTurnAuthority;
}
