/**
 * States the persisted lifecycle of one logical conversation computer.
 *
 * A computer may cool to zero and later rehydrate, but it is not an always-running Pod. Lifecycle
 * listeners use these closed values to decide whether work may be admitted and whether a lease may
 * exist; an unknown value must not be treated as warm.
 *
 * @see https://github.com/elewa-git/opencrane/issues/759 — defines the conversation-computer lifecycle and its zero-or-one lease rule.
 */
export enum ConversationComputerStates
{
	/** The computer has no live sandbox and may be restored when work is admitted. */
	Cold = "cold",
	/** The computer has requested one sandbox but has not received a live lease. */
	ClaimPending = "claim_pending",
	/** The computer has one fenced live sandbox lease. */
	Warm = "warm",
	/** The computer has stopped admitting work while an active attempt reaches a safe boundary. */
	Cooling = "cooling",
	/** The computer needs explicit recovery before it can safely resume work. */
	RecoveryRequired = "recovery_required",
	/** The computer is permanently retired and cannot receive another lease. */
	Retired = "retired",
}

/**
 * States the lifecycle of one fenced sandbox realization.
 *
 * Kubernetes realizes a lease but does not own the logical computer. An active lease has one
 * generation, and an old or lost realization must not continue to process work.
 */
export enum ComputerLeaseStates
{
	/** The upstream sandbox claim exists but a sandbox has not yet been assigned. */
	Claimed = "claimed",
	/** The sandbox realization may process work for its exact lease generation. */
	Active = "active",
	/** The computer released this realization after work reached a safe boundary. */
	Released = "released",
	/** The realization ended unexpectedly and cannot report further work. */
	Lost = "lost",
}

/**
 * Lists review surfaces an admitted computer profile may make available.
 *
 * A listed surface is still subject to current participant authorization; this enum describes the
 * profile capability, not a permission granted to a particular participant.
 */
export enum ComputerReviewSurfaces
{
	/** Allows an authorized participant to view the browser or desktop surface. */
	DesktopView = "desktop_view",
	/** Allows an authorized participant to control the browser or desktop surface. */
	DesktopControl = "desktop_control",
	/** Allows an authorized participant to view a selected terminal session. */
	TerminalView = "terminal_view",
	/** Allows an authorized participant to control a selected terminal session. */
	TerminalControl = "terminal_control",
	/** Allows an authorized participant to inspect selected workspace files. */
	FileInspect = "file_inspect",
	/** Allows an authorized participant to open one admitted preview application. */
	PreviewOpen = "preview_open",
}

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
	/** Lists the review surfaces this profile makes eligible for separate authorization. */
	readonly reviewSurfaces: readonly ComputerReviewSurfaces[];
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
 * Represents one fenced live sandbox realization of a conversation computer.
 *
 * Its generation prevents a replaced or stale Pod from acting as the current computer. A logical
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
	/** Identifies the upstream Agent Sandbox claim. */
	readonly sandboxClaimId: string;
	/** Identifies the upstream sandbox after assignment. */
	readonly sandboxId: string | null;
	/** States whether this realization may process work. */
	readonly state: ComputerLeaseStates;
	/** Records when this lease was claimed. */
	readonly claimedAt: string;
	/** Records when this lease stops accepting work. */
	readonly expiresAt: string;
	/** Records when this lease became terminal. */
	readonly releasedAt: string | null;
}
