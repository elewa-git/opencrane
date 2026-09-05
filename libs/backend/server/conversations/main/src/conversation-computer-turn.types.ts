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
	/** Deterministically compiled input for this attempt. */
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

/** Server-resolved immutable material used to freeze one pending computer turn. */
export interface ConversationComputerTurnCandidate
{
	readonly binding: BoundConversationWriterBinding;
	readonly compiledInput: CompiledRunInput;
	readonly latestPendingEntryId: string;
	readonly modelAlias: string;
	readonly maximumBudgetUsd: number;
	readonly credentialLifetimeSeconds: number;
	readonly sandboxClaimId: string;
}

/** Durable turn record; it deliberately excludes the raw LiteLLM credential. */
export interface FrozenConversationComputerTurn extends ConversationComputerTurnCandidate
{
	readonly bootstrapId: string;
	readonly computerId: string;
	readonly generation: number;
	readonly leaseId: string;
	readonly siloId: string;
	readonly outputSourceCommandId: string | null;
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

/** Owns idempotent Kurrent-backed turn freezing and output completion state. */
export interface ConversationComputerTurnStore
{
	createOrRead(turn: FrozenConversationComputerTurn): Promise<FrozenConversationComputerTurn>;
	load(bootstrapId: string): Promise<FrozenConversationComputerTurn | null>;
	markOutput(bootstrapId: string, sourceCommandId: string): Promise<"accepted" | "idempotent">;
}

/** Mints a short-lived virtual key restricted to one model alias and attempt budget. */
export interface ConversationComputerCredentialIssuer
{
	/** Atomically return the current credential or revoke it before installing a replacement. */
	issueOrRotate(input: { readonly bootstrapId: string; readonly siloId: string; readonly conversationId: string; readonly keyAlias: string; readonly modelAlias: string; readonly maxBudgetUsd: number; readonly expirySeconds: number }): Promise<{ readonly key: string; readonly credentialDigest: string }>;
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
	readonly candidates: ConversationComputerTurnCandidateResolver;
	readonly credentials: ConversationComputerCredentialIssuer;
	readonly endpoint: string;
	readonly outputPayloads: ConversationComputerOutputPayloadStore;
	readonly store: ConversationComputerTurnStore;
	readonly writers: ConversationComputerBoundWriterFactory;
}

/** Mints and revokes raw provider-gateway keys behind encrypted retry custody. */
export interface ConversationComputerRawCredentialAuthority
{
	issue(input: { readonly keyAlias: string; readonly modelAlias: string; readonly maxBudgetUsd: number; readonly expirySeconds: number }): Promise<{ readonly key: string }>;
	revoke(input: { readonly keyAlias: string; readonly key: string }): Promise<void>;
}

/** Dependencies fixed before the private conversation-computer router is mounted. */
export interface ConversationComputerTurnRouterOptions
{
	/** TokenReviews the exact audience, namespace, ServiceAccount and bound Pod UID. */
	readonly tokenReviewer: RuntimeTokenReviewer;
	/** Owns durable lease, input, model credential and output authority. */
	readonly authority: ConversationComputerTurnAuthority;
}
