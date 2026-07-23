import type { AgentRevisionId, AgentRun, AgentRunId, AgentServiceId, AgentServiceState, SiloId } from "@opencrane/models/agents";
import type { AgentRuntimeProjectedTokenAudience } from "@opencrane/contracts";

/** Workload assignment bound to exactly one logical run attempt. */
export interface RunWorkloadAssignment
{
	/** Logical run authority identifier. */
	readonly runId: AgentRunId;
	/** Stable AgentService executed by this run. */
	readonly agentServiceId: AgentServiceId;
	/** Positive attempt number authorized by the assignment. */
	readonly attempt: number;
	/** Immutable agent revision executed by this attempt. */
	readonly agentRevisionId: AgentRevisionId;
	/** Silo containing the run and workload. */
	readonly siloId: SiloId;
	/** Fixed control-plane audience for the projected workload token. */
	readonly audience: AgentRuntimeProjectedTokenAudience;
	/** Human or service subject authorized to cause the action. */
	readonly subjectId: string;
	/** Expected projected Kubernetes service account. */
	readonly serviceAccountName: string;
	/** Exact namespace containing the runtime Job. */
	readonly namespace: string;
	/** Controller-managed workload kind assigned to the run. */
	readonly workloadKind: "job";
	/** Exact immutable UID of the assigned one-attempt Job. */
	readonly workloadUid: string;
	/** Exact immutable runtime Pod UID. */
	readonly podUid: string;
	/** Epoch-millisecond hard expiry. */
	readonly expiresAtEpochMs: number;
}

/** Expected workload identity and run authority at a validation boundary. */
export interface RunWorkloadAssignmentExpectation
{
	/** Expected logical run identifier. */
	readonly runId: AgentRunId;
	/** Expected stable AgentService identifier. */
	readonly agentServiceId: AgentServiceId;
	/** Expected current run attempt. */
	readonly attempt: number;
	/** Expected immutable agent revision. */
	readonly agentRevisionId: AgentRevisionId;
	/** Expected silo. */
	readonly siloId: SiloId;
	/** Fixed control-plane audience expected from the projected workload token. */
	readonly audience: AgentRuntimeProjectedTokenAudience;
	/** Expected authorization subject. */
	readonly subjectId: string;
	/** Expected projected Kubernetes service account. */
	readonly serviceAccountName: string;
	/** Expected Kubernetes namespace. */
	readonly namespace: string;
	/** Expected controller-managed workload kind. */
	readonly workloadKind: "job";
	/** Expected immutable one-attempt Job UID. */
	readonly workloadUid: string;
	/** Expected runtime Pod UID. */
	readonly podUid: string;
	/** Trusted current epoch-millisecond time. */
	readonly nowEpochMs: number;
}

/** Stable result of validating a run-scoped workload assignment. */
export type RunWorkloadAssignmentDecision =
	| { readonly outcome: "trusted" }
	| { readonly outcome: "denied"; readonly reason: "invalid_assignment" | "invalid_attempt" | "invalid_workload_kind" | "projected_token_audience_mismatch" | "run_mismatch" | "agent_service_mismatch" | "attempt_mismatch" | "revision_mismatch" | "silo_mismatch" | "subject_mismatch" | "service_account_mismatch" | "namespace_mismatch" | "workload_kind_mismatch" | "workload_uid_mismatch" | "pod_mismatch" | "expired" };

/** Atomic compare-and-swap request for the next attempt of one logical run. */
export interface StartNextRunAttemptCommand
{
	/** Logical run being retried. */
	readonly runId: AgentRunId;
	/** Attempt observed by the caller. */
	readonly expectedAttempt: number;
	/** Trusted ISO-8601 acceptance instant for the new attempt. */
	readonly acceptedAt: string;
}

/** Current run and AgentService authority loaded as one consistent read snapshot. */
export interface AgentRunAuthoritySnapshot
{
	/** Current durable state of the logical run. */
	readonly run: AgentRun;
	/** Immutable silo identity of the referenced AgentService, or null when it no longer exists. */
	readonly agentServiceSiloId: SiloId | null;
	/** Current lifecycle state of the referenced AgentService, or null when it no longer exists. */
	readonly agentServiceState: AgentServiceState | null;
	/** Current active revision of the referenced AgentService, or null when none is active. */
	readonly activeAgentRevisionId: AgentRevisionId | null;
}

/** Atomic retry request bound to the exact AgentService authority accepted by the domain. */
export interface AtomicStartNextRunAttemptCommand extends StartNextRunAttemptCommand
{
	/** AgentService identity immutable on the run and required by the compare-and-swap. */
	readonly expectedAgentServiceId: AgentServiceId;
	/** Immutable AgentService silo that must still match the run at compare-and-swap time. */
	readonly expectedAgentServiceSiloId: SiloId;
	/** Executable lifecycle state required at the instant the retry starts. */
	readonly expectedAgentServiceState: "active";
	/** Exact active revision required at the instant the retry starts. */
	readonly expectedActiveAgentRevisionId: AgentRevisionId;
}

/** Result of incrementing one logical run's attempt under optimistic concurrency. */
export type AtomicRunAttemptResult =
	| { readonly status: "started"; readonly run: AgentRun }
	| { readonly status: "attempt_conflict"; readonly currentAttempt: number }
	| { readonly status: "agent_service_authority_conflict"; readonly currentAgentServiceState: AgentServiceState | null; readonly currentAgentServiceSiloId: SiloId | null; readonly currentActiveAgentRevisionId: AgentRevisionId | null }
	| { readonly status: "not_found" };

/** Persistence boundary that keeps one AgentRun authority while attempts increment. */
export interface AgentRunAuthorityRepository
{
	/** Loads the run and referenced AgentService authority as one consistent read snapshot. */
	getRunAuthority(runId: AgentRunId): Promise<AgentRunAuthoritySnapshot | null>;
	/** Atomically increments only while both run attempt and exact active AgentService revision still match. */
	startNextAttemptAtomically(command: AtomicStartNextRunAttemptCommand): Promise<AtomicRunAttemptResult>;
}

/** Stable outcome of requesting a new attempt for one logical run. */
export type StartNextRunAttemptResult =
	| { readonly outcome: "started"; readonly run: AgentRun }
	| { readonly outcome: "denied"; readonly reason: "invalid_command" | "run_not_found" | "run_not_terminal" | "agent_service_inactive" | "agent_service_silo_mismatch" | "agent_revision_superseded" | "attempt_conflict"; readonly currentAttempt?: number };
