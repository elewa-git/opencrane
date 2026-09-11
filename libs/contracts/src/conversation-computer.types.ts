/**
 * States the persisted lifecycle of one logical conversation computer.
 *
 * A computer may cool to zero and later rehydrate, but it is not an always-running process. Lifecycle
 * listeners use these closed values to decide whether work may be admitted and whether a lease may
 * exist; an unknown value must not be treated as warm.
 *
 * @see https://github.com/elewa-git/opencrane/issues/759 — defines the conversation-computer lifecycle and its zero-or-one lease rule.
 */
export enum ConversationComputerStates
{
	/** The computer has no live realization and may activate when work is admitted. */
	Cold = "cold",
	/** The computer has reserved one realization but has not received a live lease. */
	ClaimPending = "claim_pending",
	/** The computer has one fenced live realization lease. */
	Warm = "warm",
	/** The computer has stopped admitting work while an active attempt reaches a safe boundary. */
	Cooling = "cooling",
	/** The computer needs explicit recovery before it can safely resume work. */
	RecoveryRequired = "recovery_required",
	/** The computer is permanently retired and cannot receive another lease. */
	Retired = "retired",
}

/**
 * States the lifecycle of one fenced process realization.
 *
 * The selected adapter realizes a lease but does not own the logical computer. An active lease has
 * one generation, and an old or lost realization must not continue to process work.
 */
export enum ComputerLeaseStates
{
	/** The realization is reserved but its process has not yet been assigned or started. */
	Claimed = "claimed",
	/** The realized process may accept work for its lease generation. */
	Active = "active",
	/** The computer released this realization after work reached a safe boundary. */
	Released = "released",
	/** The lease expired or its process disappeared before an orderly release. */
	Lost = "lost",
}

/**
 * Selects how one conversation-computer lease is physically realised.
 *
 * These string values are stored in KurrentDB with the lease snapshot. They let product history
 * describe a production Agent Sandbox or a workstation process without inventing Kubernetes
 * identity for local development. Unknown values fail history parsing.
 */
export enum ConversationComputerRealizationKinds
{
	/** An Agent Sandbox claim and its assigned Kubernetes sandbox realise the lease. */
	AgentSandbox = "agent_sandbox",
	/** A child process bound to loopback realises the lease for local development. */
	HostDevelopmentProcess = "host_development_process",
}

/** Records the controller coordinates for one production Agent Sandbox realisation. */
export interface AgentSandboxConversationComputerRealization
{
	/** Selects the production Agent Sandbox adapter. */
	readonly kind: ConversationComputerRealizationKinds.AgentSandbox;
	/** Identifies the upstream Agent Sandbox claim. */
	readonly claimId: string;
	/** Identifies the assigned sandbox, or null while the claim is pending. */
	readonly sandboxId: string | null;
	/** Carries the controller-reported in-cluster Service address after assignment. */
	readonly serviceFQDN: string | null;
}

/**
 * Records the non-secret coordinates for one workstation child-process realisation.
 *
 * These coordinates make no confinement or capacity claim. Host development does not apply the
 * Kubernetes RuntimeClass, network policy, resource ceiling or checkpoint transport from a
 * production computer profile.
 */
export interface HostDevelopmentConversationComputerRealization
{
	/** Selects the workstation process adapter. */
	readonly kind: ConversationComputerRealizationKinds.HostDevelopmentProcess;
	/** Identifies the child owned by the local supervisor without granting access to it. */
	readonly processId: string;
	/** Carries the loopback-only private endpoint used by this child. */
	readonly endpoint: string;
}

/**
 * Describes the physical process behind a lease without storing its authentication secret.
 *
 * The active lease generation remains the product authority. A realisation records where that
 * generation runs; it does not grant permission by itself.
 */
export type ConversationComputerRealization = AgentSandboxConversationComputerRealization | HostDevelopmentConversationComputerRealization;

/**
 * Fixes the requested and maximum resources that one immutable profile permits.
 *
 * A profile keeps resource limits with the admitted realization rather than letting an individual
 * conversation computer select them while it wakes.
 */
export interface ComputerResourceCeiling
{
	/** Sets the requested central processing unit capacity. */
	readonly requestedCpu: string;
	/** Sets the requested memory capacity. */
	readonly requestedMemory: string;
	/** Sets the maximum central processing unit capacity. */
	readonly maximumCpu: string;
	/** Sets the maximum memory capacity. */
	readonly maximumMemory: string;
}

/** Describes one admitted computer data-plane endpoint and protocol version. */
export interface ComputerDataPlaneEndpoint
{
	/** Names the server-owned endpoint purpose. */
	readonly kind: string;
	/** Names the admitted protocol version. */
	readonly protocolVersion: string;
	/** Stores the server-owned endpoint address. */
	readonly endpoint: string;
}

/**
 * Defines one admitted immutable profile for realizing a conversation computer.
 *
 * The profile binds its image digest, RuntimeClass, data-plane endpoints, resource limits, network
 * profile, and workspace format before a computer wakes. A replacement uses the admitted profile
 * rather than letting the live sandbox choose its own execution configuration.
 */
export interface ComputerProfileRevision
{
	/** Names the persisted contract shape. */
	readonly schemaVersion: 1;
	/** Identifies this immutable profile revision. */
	readonly id: string;
	/** Identifies the silo that owns this profile revision. */
	readonly siloId: string;
	/** Pins the admitted Open Container Initiative image by digest. */
	readonly imageDigest: string;
	/** Names the approved Kubernetes RuntimeClass. */
	readonly runtimeClassName: string;
	/** Identifies the immutable confinement policy applied by the SandboxTemplate. */
	readonly securityProfileId: string;
	/** Lists the admitted data-plane routes and protocol versions. */
	readonly dataPlaneEndpoints: readonly ComputerDataPlaneEndpoint[];
	/** Names the compatible workspace checkpoint format. */
	readonly workspaceCheckpointFormat: string;
	/** Fixes the requested and maximum resource capacity. */
	readonly resourceCeiling: ComputerResourceCeiling;
	/** Identifies the default-deny network policy profile. */
	readonly networkProfileId: string;
	/** Identifies the principal that admitted this immutable profile. */
	readonly admittedByPrincipalId: string;
	/** Records when this profile was admitted. */
	readonly admittedAt: string;
}

/**
 * Identifies the latest verified workspace snapshot for a computer.
 *
 * Cold restoration reads the checkpoint that matches the admitted profile format after its content
 * digest verifies; an uncheckpointed mutation is recoverable work, not durable workspace state.
 */
export interface ComputerWorkspaceCheckpoint
{
	/** Identifies the immutable ArtifactStore revision that contains the checkpoint manifest. */
	readonly artifactRevisionId: string;
	/** Identifies the content digest verified before restoration. */
	readonly digest: string;
	/** Names the checkpoint format expected by the profile. */
	readonly format: string;
	/** Records when the checkpoint was accepted. */
	readonly checkpointedAt: string;
}

/**
 * Represents the logical private computer owned by one agent conversation.
 *
 * The record persists across cold and warm realizations and binds the conversation to its resolved
 * agent identity and admitted profile. Direct and group conversations without an agent do not create
 * this record, and the state may have zero or one active lease.
 */
export interface ConversationComputer
{
	/** Names the persisted contract shape. */
	readonly schemaVersion: 1;
	/** Identifies this logical computer. */
	readonly id: string;
	/** Identifies the silo that owns this computer. */
	readonly siloId: string;
	/** Identifies the one agent conversation that owns this computer. */
	readonly conversationId: string;
	/** Identifies the agent identity bound to this computer. */
	readonly agentIdentityId: string;
	/** Identifies the immutable profile revision used for realization. */
	readonly profileRevisionId: string;
	/** States the durable lifecycle of this logical computer. */
	readonly state: ConversationComputerStates;
	/** Stores the next monotonic lease generation. */
	readonly leaseGeneration: number;
	/** Stores the latest verified workspace checkpoint when one exists. */
	readonly workspaceCheckpoint: ComputerWorkspaceCheckpoint | null;
	/** Records when this computer was created. */
	readonly createdAt: string;
	/** Records the most recent durable computer-state change. */
	readonly updatedAt: string;
}

/**
 * Represents one fenced live realization of a conversation computer.
 *
 * Its generation prevents a replaced or stale process from acting as the current computer. A logical
 * computer can have at most one active lease, although it retains prior lease history.
 */
export interface ComputerLease
{
	/** Names the persisted contract shape. */
	readonly schemaVersion: 1;
	/** Identifies this lease. */
	readonly id: string;
	/** Identifies the logical computer that owns this lease. */
	readonly computerId: string;
	/** Fences this realization from every earlier lease. */
	readonly generation: number;
	/** Describes the physical process behind this lease without storing its bearer credential. */
	readonly realization: ConversationComputerRealization;
	/** States whether this realization may process work. */
	readonly state: ComputerLeaseStates;
	/** Records when this lease was claimed. */
	readonly claimedAt: string;
	/** Records when this lease stops accepting work. */
	readonly expiresAt: string;
	/** Records when this lease became terminal. */
	readonly releasedAt: string | null;
}
/** Audience fixed on every projected conversation-computer ServiceAccount token. */
export const CONVERSATION_COMPUTER_PROJECTED_TOKEN_AUDIENCE = "opencrane-conversation-computer";
