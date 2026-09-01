/**
 * States why an already-admitted ConversationComputer generation requests a sandbox lease.
 *
 * These values are serialized into the claim annotation that the release admission policy accepts.
 * Adding a reason therefore requires a matching policy change instead of letting a caller attach
 * arbitrary activation state to a Kubernetes resource.
 */
export enum AgentSandboxClaimReason
{
	/** Starts the generation that was just activated from durable computer history. */
	ActivationRequested = "activation_requested",
	/** Replaces a generation whose durable computer authority has requested recovery. */
	RecoveryRequested = "recovery_requested",
}

/**
 * Carries the Kubernetes coordinates and immutable lease details for one SandboxClaim.
 *
 * A domain authority must authorize the action, fence the generation, select the admitted profile,
 * and persist the desired activation before it creates this command. This adapter validates the
 * claim shape; it never treats that validation as authorization.
 */
export interface AgentSandboxClaimCommand
{
	/** Names the release-owned namespace where Agent Sandbox resources live. */
	readonly namespace: string;
	/** Names the bounded silo that owns the ConversationComputer. */
	readonly siloId: string;
	/** Names the ConversationComputer; it must begin with `computer-`. */
	readonly computerId: string;
	/** Fences the computer generation that may use this claim. */
	readonly generation: number;
	/** Selects one release-admitted sandbox profile. */
	readonly profile: string;
	/** Selects the release-owned warm pool mapped to that profile. */
	readonly warmPoolName: string;
	/** Carries the immutable release labels that identify the admitted Sandbox Pods. */
	readonly podLabels: AgentSandboxClaimPodLabels;
	/** States whether activation or recovery requested the lease. */
	readonly reason: AgentSandboxClaimReason;
	/** Sets the foreground-delete deadline accepted by the admission policy. */
	readonly shutdownTime: Date;
}

/**
 * Names the release selectors that identify the Sandbox Pod created for an admitted computer.
 *
 * The server obtains these values from its immutable activation profile, while the claim authority
 * adds the component and computer labels itself. Callers therefore cannot redirect a Pod into a
 * different release boundary.
 * @see AgentSandboxClaimCommand
 */
export interface AgentSandboxClaimPodLabels
{
	/** Names the Helm application label shared with the server NetworkPolicy selector. */
	readonly applicationName: string;
	/** Names the immutable Helm release label shared with the server NetworkPolicy selector. */
	readonly releaseName: string;
}

/**
 * Reports the deterministic SandboxClaim that represents one computer generation.
 *
 * `created` means this call submitted the generation's claim. `existing` means a retry received a
 * conflict and confirmed every lease field on the claim already stored by Kubernetes.
 */
export interface AgentSandboxClaimReceipt
{
	/** Names the Kubernetes namespace containing the claim. */
	readonly namespace: string;
	/** Names the claim derived from computer id and generation. */
	readonly claimName: string;
	/** Identifies whether this call created the claim or confirmed an exact prior claim. */
	readonly disposition: "created" | "existing";
}

/**
 * Requests the claim that realizes a previously admitted computer generation.
 *
 * The port provides convergence for activation retries and upstream-controller restarts without
 * giving application code authority to select images, change a claim, watch Pods, or reconcile
 * their lifecycle.
 */
export interface AgentSandboxClaimAuthority
{
	/**
	 * Creates a deterministic claim or verifies that an existing claim has the requested lease.
	 *
	 * @param command - The already-authorized generation, profile, pool, and shutdown deadline.
	 * @returns `created` after the Kubernetes create succeeds, or `existing` after a 409 read matches.
	 * @throws {Error} When the command is malformed or a conflicting claim has different lease fields.
	 */
	ensure(command: AgentSandboxClaimCommand): Promise<AgentSandboxClaimReceipt>;
}

/**
 * Supplies the immutable claim coordinates that a status reader must verify before using status.
 *
 * The domain authority derives every field from checked computer history and the release profile.
 * A status reader receives no authority to choose a claim, profile, warm pool, or lease deadline.
 */
export interface AgentSandboxClaimObservationCommand extends AgentSandboxClaimCommand {}

/**
 * States whether an exact immutable claim has a current controller-published sandbox assignment.
 *
 * The reader returns this transient observation to a reconciliation authority; neither value is
 * written as claim lifecycle state. `Ready` is usable only with the accompanying sandbox id after
 * the authority rechecks its durable lease, while `Pending` leaves that lease unchanged.
 */
export enum AgentSandboxClaimObservationStates
{
	/** The claim is absent, unready, or reports only stale controller status. */
	Pending = "pending",
	/** The exact claim reports its current ready sandbox assignment. */
	Ready = "ready",
}

/** Reports the one Agent Sandbox status result safe for ConversationComputer reconciliation. */
export type AgentSandboxClaimObservation =
	| { readonly state: AgentSandboxClaimObservationStates.Pending }
	| { readonly state: AgentSandboxClaimObservationStates.Ready; readonly sandboxId: string };

/**
 * Supplies the server-derived coordinates used to inspect one assigned Sandbox realization.
 *
 * The exact claim reader supplies `sandboxId`; the release profile supplies namespace and
 * ServiceAccount. No caller may select a Pod name or any Kubernetes identity coordinate.
 */
export interface AgentSandboxRuntimePodCommand
{
	/** Names the release-owned namespace containing the Sandbox and backing Pod. */
	readonly namespace: string;
	/** Names the controller-published Sandbox assigned to the exact ready claim. */
	readonly sandboxId: string;
	/** Names the ServiceAccount fixed by the admitted SandboxTemplate. */
	readonly serviceAccountName: string;
}

/** Identifies an exact current Pod realization of one controller-owned Sandbox. */
export interface AgentSandboxRuntimePod
{
	/** Names the release-owned namespace containing this Pod. */
	readonly namespace: string;
	/** Names the ServiceAccount attached to this Pod by the SandboxTemplate. */
	readonly serviceAccountName: string;
	/** Identifies the exact Kubernetes Pod instance, including replacement fencing. */
	readonly podUid: string;
}

/**
 * Reads the backing Pod identity for the Sandbox assigned by one ready claim.
 *
 * A ready claim supplies a Sandbox name, not authority over a Pod. The reconciliation authority
 * treats a null result as pending and persists an identity only after this reader verifies the
 * release namespace, template ServiceAccount, controller owner reference, and Pod UID.
 *
 * Called by: `ConversationComputerSandboxReconciliationAuthority`.
 */
export interface AgentSandboxRuntimePodReader
{
	/**
	 * Returns the exact ready Pod identity or null while the controller has not published a safe realization.
	 *
	 * @param command - Supplies claim- and profile-derived Sandbox coordinates.
	 * @returns The immutable Pod identity only after Sandbox ownership, namespace, and ServiceAccount checks pass.
	 * @throws {Error} When Kubernetes is unavailable or a found resource is malformed or foreign.
	 */
	read(command: AgentSandboxRuntimePodCommand): Promise<AgentSandboxRuntimePod | null>;
}

/**
 * Reads a deterministic Agent Sandbox claim without taking any lifecycle action.
 *
 * The port is deliberately distinct from claim creation: reconciliation may observe only the
 * exact, immutable claim that checked history already dispatched. It does not list, watch, or
 * mutate resources; the separate runtime-Pod reader owns assigned Sandbox and Pod verification.
 */
export interface AgentSandboxClaimObservationReader
{
	/**
	 * Returns a verified ready sandbox id or a nonterminal pending result for one exact claim.
	 *
	 * @param command - Supplies immutable lease coordinates derived from checked history.
	 * @returns `ready` only after the exact claim reports its current Ready condition and sandbox id.
	 * @throws {Error} When Kubernetes is unavailable or a found claim differs from the expected lease.
	 */
	observe(command: AgentSandboxClaimObservationCommand): Promise<AgentSandboxClaimObservation>;
}

/**
 * Limits a Kubernetes custom-resource client to the namespaced reads and writes this package needs.
 *
 * The release Role grants only claim create/get plus Sandbox get. Keeping the port equally narrow
 * prevents this infrastructure adapter from growing its own lifecycle or Pod-controller authority.
 */
export interface AgentSandboxClaimCustomObjectsApi
{
	/**
	 * Requests creation of a namespaced custom object.
	 *
	 * @param request - The Agent Sandbox API coordinates and admission-policy-safe resource body.
	 * @returns The untrusted Kubernetes response, which this adapter does not need to interpret.
	 */
	createNamespacedCustomObject(request: {
		readonly group: string;
		readonly version: string;
		readonly namespace: string;
		readonly plural: string;
		readonly body: Record<string, unknown>;
	}): Promise<unknown>;
	/**
	 * Reads one namespaced custom object by its trusted deterministic resource name.
	 *
	 * @param request - The Agent Sandbox API coordinates and checked resource name.
	 * @returns The untrusted Kubernetes response for immutable-field or ownership comparison.
	 */
	getNamespacedCustomObject(request: {
		readonly group: string;
		readonly version: string;
		readonly namespace: string;
		readonly plural: string;
		readonly name: string;
	}): Promise<unknown>;
}

/**
 * Limits the Core client to the namespaced backing-Pod read required for lease identity.
 *
 * The release Role grants `get` on Pods in the Agent Sandbox namespace, rather than discovery or
 * mutation permissions, so this adapter cannot select or change another workload.
 */
export interface AgentSandboxCoreApi
{
	/**
	 * Reads one named Pod in the assigned Sandbox namespace.
	 *
	 * @param request - Supplies the controller-published Pod name and release-owned namespace.
	 * @returns The untrusted Kubernetes Pod resource.
	 */
	readNamespacedPod(request: { readonly namespace: string; readonly name: string }): Promise<unknown>;
}
