/** Exact durable run coordinates selected by the OpenCrane authority. */
export interface DesiredAgentJob
{
	/** Logical run identifier. */
	readonly runId: string;
	/** Positive durable attempt number. */
	readonly attempt: number;
	/** Immutable AgentService identifier. */
	readonly agentServiceId: string;
	/** Immutable AgentRevision identifier. */
	readonly agentRevisionId: string;
	/** Silo whose authority selected the run. */
	readonly siloId: string;
	/** Subject that authorized the run. */
	readonly subjectId: string;
	/** Exact runtime namespace selected by OpenCrane. */
	readonly namespace: string;
	/** Exact runtime service account selected by OpenCrane. */
	readonly serviceAccountName: string;
	/** Immutable OCI image reference selected by OpenCrane. */
	readonly image: string;
}

/** Minimal immutable projection of one bounded Kubernetes Job. */
export interface AgentJobProjection
{
	/** Deterministic Kubernetes Job name. */
	readonly name: string;
	/** Namespace in which the Job is allowed to exist. */
	readonly namespace: string;
	/** Labels that bind the Job to one exact durable attempt. */
	readonly labels: Readonly<Record<string, string>>;
	/** Runtime service account with no Kubernetes RBAC. */
	readonly serviceAccountName: string;
	/** Exact controller-approved runtime image. */
	readonly image: string;
	/** Whether the Job must remain suspended. */
	readonly suspend: boolean;
	/** No retry is delegated to Kubernetes under the same durable attempt. */
	readonly backoffLimit: 0;
	/** Audience-bound runtime projected-token TTL sourced from the app-owned runtime profile. */
	readonly projectedTokenTtlSeconds: number;
}

/** Immutable identity returned by Kubernetes after Job creation. */
export interface ObservedAgentJob
{
	/** Deterministic Job name. */
	readonly name: string;
	/** Immutable labels observed on the Kubernetes Job. */
	readonly labels: Readonly<Record<string, string>>;
	/** Kubernetes-assigned immutable Job UID. */
	readonly uid: string;
	/** Whether the current Job is suspended. */
	readonly suspended: boolean;
}

/** Controller configuration that pins every Kubernetes projection boundary. */
export interface AgentControllerPolicy
{
	/** Only namespace the controller can project into. */
	readonly runtimeNamespace: string;
	/** Only workload KSA the controller may assign. */
	readonly runtimeServiceAccountName: string;
	/** Only runtime image the controller may project. */
	readonly runtimeImage: string;
	/** Runtime projected-token TTL pinned by the app-owned runtime identity profile. */
	readonly runtimeProjectedTokenTtlSeconds: number;
	/** Immutable workload labels required by the runtime app's NetworkPolicy selectors. */
	readonly runtimePodLabels: Readonly<Record<string, string>>;
}

/** OpenCrane-owned source of already-authorized desired state. */
export interface DesiredAgentJobSource
{
	/** Return at most one desired Job, or null when the authority has no work. */
	readNext(): Promise<DesiredAgentJob | null>;
}

/** Kubernetes-only port owned by the controller app adapter. */
export interface AgentJobMutator
{
	/** Verify Kubernetes API reachability and the controller's namespaced Job-list permission. */
	check(namespace: string): Promise<void>;
	/** Load a Job by deterministic identity without modifying it. */
	get(projection: AgentJobProjection): Promise<ObservedAgentJob | null>;
	/** Create a suspended Job and return its immutable identity. */
	createSuspended(projection: AgentJobProjection): Promise<ObservedAgentJob>;
	/** Delete an unexpectedly active Job by its exact immutable UID. */
	delete(projection: AgentJobProjection, workloadUid: string): Promise<void>;
	/** Unsuspend only the exact Job whose identity was durably acknowledged. */
	unsuspend(projection: AgentJobProjection, workloadUid: string): Promise<void>;
	/** Return the first observed runtime Pod UID for the exact Job, if any. */
	firstPodUid(projection: AgentJobProjection, workloadUid: string): Promise<string | null>;
}

/** OpenCrane-owned acknowledgement sink; this is never a controller database. */
export interface AgentJobStatusReporter
{
	/** Durably reject an invalid desired record so it cannot starve later work. */
	rejectDesired(desired: DesiredAgentJob, reason: "invalid_desired_job" | "unsafe_existing_job"): Promise<void>;
	/** Durably bind the immutable Job UID before it can start. */
	recordJob(desired: DesiredAgentJob, projection: AgentJobProjection, workloadUid: string): Promise<AgentJobStartDecision>;
	/** Durably bind the first runtime Pod UID after Kubernetes creates it. */
	recordPod(desired: DesiredAgentJob, projection: AgentJobProjection, workloadUid: string, podUid: string): Promise<void>;
}

/** Server-authoritative decision on whether bootstrap delivery makes a suspended Job safe to start. */
export interface AgentJobStartDecision
{
	/** Only true after the future runtime authority proves UID-bound bootstrap delivery is ready. */
	readonly bootstrapReady: boolean;
}

/** Dependencies for one bounded, idempotent controller reconciliation. */
export interface AgentControllerDependencies
{
	/** Pinned projection policy. */
	readonly policy: AgentControllerPolicy;
	/** OpenCrane desired-state authority. */
	readonly desiredJobs: DesiredAgentJobSource;
	/** Kubernetes mutation/read adapter. */
	readonly jobs: AgentJobMutator;
	/** OpenCrane acknowledgement authority. */
	readonly status: AgentJobStatusReporter;
}

/** Observable result of reconciling at most one desired Job. */
export type AgentControllerReconcileResult =
	| { readonly outcome: "idle" }
	| { readonly outcome: "prepared"; readonly runId: string; readonly attempt: number; readonly workloadUid: string }
	| { readonly outcome: "reconciled"; readonly runId: string; readonly attempt: number; readonly workloadUid: string; readonly podUid: string | null }
	| { readonly outcome: "rejected"; readonly reason: "invalid_desired_job" | "mismatched_existing_job" | "unsafe_existing_job"; readonly runId: string; readonly attempt: number };
