import type { ConfigurationOptions, V1Job, V1Pod, V1PodList } from "@kubernetes/client-node";

/**
 * Defines the Kubernetes work that a class-specific controller may request after it receives a
 * database claim. Implementations must compare the complete expected manifest, its saved Job UID,
 * and the first Pod's ownership before returning Kubernetes state to the database authority.
 *
 * Called by: the skill-authoring, artifact-preprocessing, and MCP workflow handlers.
 */
export interface GovernedJobControllerStore
{
	/**
	 * Creates the expected suspended Job, or adopts an existing suspended Job when its owned fields
	 * match. The caller must save the UID from the returned Job before it asks for release.
	 *
	 * @param expected - The complete suspended Job built by the workload class.
	 * @returns The Job that Kubernetes created or the matching Job already stored there.
	 * @throws When Kubernetes returns a Job that differs from the expected manifest.
	 */
	ensureSuspendedJob(expected: V1Job): Promise<V1Job>;
	/**
	 * Releases the Job identified by the saved UID through a resource-version-checked patch. A Job
	 * that is already running is returned only after the same identity and manifest checks pass.
	 *
	 * @param expected - The suspended manifest recorded for this assignment.
	 * @param workloadUid - The Kubernetes UID saved when the assignment was committed.
	 * @param releaseFence - The database expiry or database-calculated remaining lifetime that bounds the Job.
	 * @returns The verified Job with `spec.suspend` set to `false`.
	 * @throws When the claim has expired or Kubernetes no longer holds the assigned Job.
	 */
	releaseJob(expected: V1Job, workloadUid: string, releaseFence: GovernedJobReleaseFence): Promise<V1Job>;
	/**
	 * Finds the first Pod for the saved Job UID and verifies its owner, labels, namespace, and service
	 * account before the controller records that Pod in the database.
	 *
	 * @param expectedJob - The Job manifest whose Pod template supplies the expected labels.
	 * @param workloadUid - The Kubernetes Job UID saved by the assignment.
	 * @param serviceAccountName - The workload class's deployment-owned service account.
	 * @returns The verified Pod, or `null` while Kubernetes has not created one.
	 * @throws When more than one Pod matches or the returned Pod differs from the assigned Job.
	 */
	findFirstPod(expectedJob: V1Job, workloadUid: string, serviceAccountName: string): Promise<V1Pod | null>;
	/**
	 * Observes the exact released Job after its first Pod has been bound.
	 *
	 * @param expectedJob - Complete Job manifest used for the saved assignment.
	 * @param workloadUid - Immutable Job UID saved by the durable owner.
	 * @returns The state that tells the caller whether to wait or save failure before cleanup.
	 * @throws When a present Job is suspended, differs from the assignment, or has ambiguous terminal conditions.
	 * @see GovernedJobObservation for what the caller must do with each state.
	 */
	observeJob(expectedJob: V1Job, workloadUid: string): Promise<GovernedJobObservation>;
	/**
	 * Deletes the Job identified by the saved UID after its class-specific durable owner has made
	 * completion terminal. A missing Job is an idempotent success, but a replacement UID is not.
	 *
	 * @param expectedJob - The complete Job manifest whose deterministic coordinates are deleted.
	 * @param workloadUid - The Kubernetes Job UID saved by the durable assignment.
	 * @returns Nothing after Kubernetes accepts the UID-fenced deletion or reports the Job missing.
	 * @throws When Kubernetes rejects the deletion or the saved UID no longer owns the Job name.
	 */
	deleteJob(expectedJob: V1Job, workloadUid: string): Promise<void>;
}

/**
 * Bounds a Job release with database authority instead of trusting the controller clock.
 *
 * Existing workload classes pass an absolute database expiry. Remote authorities pass a remaining
 * lifetime calculated from database time, after subtracting the HTTP round trip, so the controller
 * does not compare its clock with the database clock. The Kubernetes store then reserves enough
 * lifetime for its read and patch requests before it releases the Job.
 *
 * Called by: each class-specific governed Job controller immediately before Kubernetes release.
 */
export type GovernedJobReleaseFence = { readonly expiresAt: string } | { readonly lifetimeSeconds: number };

/**
 * Tells a workload workflow what it may do after the store verifies the released Kubernetes Job.
 *
 * `running` means the Job still exists without a true `Complete` or `Failed` condition, so the
 * caller must leave it in place and check again later. `terminal` means exactly one of those
 * conditions is true; the caller must save the missing product outcome before it deletes the Job.
 * `missing` means Kubernetes returned HTTP 404; the caller must still save the missing product
 * outcome, while later deletion may finish as an idempotent success.
 *
 * The store returns this value in memory and does not persist it. Called by:
 * `ArtifactPreprocessKubernetesStore.observeJob` during the one-second recovery heartbeat.
 */
export type GovernedJobObservation = "running" | "terminal" | "missing";

/**
 * Limits the Kubernetes Batch client to the calls needed for suspended creation and fenced release.
 * An implementation must accept the supplied request options so shutdown and timeout signals reach
 * every Kubernetes request.
 *
 * Called by: {@link GovernedJobControllerStoreOptions.batchApi} in the shared Job store; production
 * adapters pass the generated Kubernetes `BatchV1Api` client.
 */
export interface GovernedJobControllerBatchApi
{
	/** Creates the class-built suspended Job and returns the server-assigned metadata. */
	createNamespacedJob(request: { readonly namespace: string; readonly body: V1Job }, options?: ConfigurationOptions): Promise<V1Job>;
	/** Reads the named Job so the store can verify it before adoption or release. */
	readNamespacedJob(request: { readonly namespace: string; readonly name: string }, options?: ConfigurationOptions): Promise<V1Job>;
	/** Applies the patch that tests the saved UID and resource version before releasing the Job. */
	patchNamespacedJob(request: { readonly namespace: string; readonly name: string; readonly body: readonly { readonly op: "test" | "replace"; readonly path: "/metadata/uid" | "/metadata/resourceVersion" | "/spec/activeDeadlineSeconds" | "/spec/suspend"; readonly value: string | number | boolean }[] }, options?: ConfigurationOptions): Promise<V1Job>;
	/** Deletes the named Job only while its immutable UID still matches the durable assignment. */
	deleteNamespacedJob(request: { readonly namespace: string; readonly name: string; readonly body: { readonly preconditions: { readonly uid: string } } }, options?: ConfigurationOptions): Promise<unknown>;
}

/**
 * Limits the Kubernetes Core client to finding the Pod created for a released Job. The
 * implementation must accept the supplied request options so the lookup ends on shutdown or timeout.
 *
 * Called by: {@link GovernedJobControllerStoreOptions.coreApi} in the shared Job store; production
 * adapters pass the generated Kubernetes `CoreV1Api` client.
 */
export interface GovernedJobControllerCoreApi
{
	/** Lists Pods through the saved Job UID and the workload class's label. */
	listNamespacedPod(request: { readonly namespace: string; readonly labelSelector: string }, options?: ConfigurationOptions): Promise<V1PodList>;
}

/**
 * Configures the shared Job checks for one workload class. Class-specific adapters choose the label
 * and trace names in code, while the process supplies its Kubernetes clients, request deadline, and
 * shutdown signal.
 *
 * Called by: `__CreateKubernetesSkillAuthoringValidationStore` and
 * `__CreateKubernetesMcpExecutorControllerStore` when the agent controller starts.
 */
export interface GovernedJobControllerStoreOptions
{
	/** Batch API whose RBAC permits only the class-owned Job namespaces. */
	readonly batchApi: GovernedJobControllerBatchApi;
	/** Core API whose RBAC permits only Pod listing in those namespaces. */
	readonly coreApi: GovernedJobControllerCoreApi;
	/** Hard deadline for every Kubernetes request. */
	readonly requestTimeoutMilliseconds: number;
	/** Process shutdown signal propagated to every Kubernetes request. */
	readonly shutdownSignal: AbortSignal;
	/** Exact code-owned label key whose value is the deterministic Job name. */
	readonly workloadLabelKey: string;
	/** Stable trace name for the class-specific release operation. */
	readonly releaseTraceName: string;
}
