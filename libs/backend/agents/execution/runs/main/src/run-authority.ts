import type { AgentRun } from "@opencrane/models/agents";
import { AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE } from "@opencrane/contracts";

import type { AgentRunAuthorityRepository, RunWorkloadAssignment, RunWorkloadAssignmentDecision, RunWorkloadAssignmentExpectation, StartNextRunAttemptCommand, StartNextRunAttemptResult } from "./run-authority.types.js";

/** Returns whether a run is in a retryable terminal state. */
function _isRetryable(run: AgentRun): boolean
{
	return run.state === "failed" || run.state === "cancelled";
}

/** Return whether the personal-run workload is the sole accepted one-attempt Job kind. */
function _isWorkloadKind(value: string): value is "job"
{
	return value === "job";
}

/**
 * Validates that a workload assignment belongs to the exact logical run attempt and Pod identity.
 * The projected ServiceAccount is only transport identity; trust is returned only when it intersects
 * the server-owned run, revision, Job, Pod, subject, namespace, audience, and expiry facts.
 * @param assignment - Proof-bound workload assignment presented by the runtime.
 * @param expectation - Current authority and trusted identity facts.
 * @returns Trusted only when every field and the hard expiry match.
 */
export function __ValidateRunWorkloadAssignment(assignment: RunWorkloadAssignment, expectation: RunWorkloadAssignmentExpectation): RunWorkloadAssignmentDecision
{
	// 1. Malformed authority identifiers and counters cannot be made valid by matching each other.
	const requiredIdentifiers = [assignment.runId, assignment.agentServiceId, assignment.agentRevisionId, assignment.siloId, assignment.audience, assignment.subjectId, assignment.serviceAccountName, assignment.namespace, assignment.workloadUid, assignment.podUid, expectation.runId, expectation.agentServiceId, expectation.agentRevisionId, expectation.siloId, expectation.audience, expectation.subjectId, expectation.serviceAccountName, expectation.namespace, expectation.workloadUid, expectation.podUid];
	if (requiredIdentifiers.some(value => !value.trim())) return { outcome: "denied", reason: "invalid_assignment" };
	if (!Number.isSafeInteger(assignment.attempt) || assignment.attempt < 1 || !Number.isSafeInteger(expectation.attempt) || expectation.attempt < 1)
	{
		return { outcome: "denied", reason: "invalid_attempt" };
	}
	if (!_isWorkloadKind(assignment.workloadKind) || !_isWorkloadKind(expectation.workloadKind)) return { outcome: "denied", reason: "invalid_workload_kind" };

	// 2. Every independently trusted identity and run-attempt field must match exactly.
	if (assignment.runId !== expectation.runId) return { outcome: "denied", reason: "run_mismatch" };
	if (assignment.agentServiceId !== expectation.agentServiceId) return { outcome: "denied", reason: "agent_service_mismatch" };
	if (assignment.attempt !== expectation.attempt) return { outcome: "denied", reason: "attempt_mismatch" };
	if (assignment.agentRevisionId !== expectation.agentRevisionId) return { outcome: "denied", reason: "revision_mismatch" };
	if (assignment.siloId !== expectation.siloId) return { outcome: "denied", reason: "silo_mismatch" };
	if (assignment.audience !== AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE || expectation.audience !== AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE) return { outcome: "denied", reason: "projected_token_audience_mismatch" };
	if (assignment.subjectId !== expectation.subjectId) return { outcome: "denied", reason: "subject_mismatch" };
	if (assignment.serviceAccountName !== expectation.serviceAccountName) return { outcome: "denied", reason: "service_account_mismatch" };
	if (assignment.namespace !== expectation.namespace) return { outcome: "denied", reason: "namespace_mismatch" };
	if (assignment.workloadKind !== expectation.workloadKind) return { outcome: "denied", reason: "workload_kind_mismatch" };
	if (assignment.workloadUid !== expectation.workloadUid) return { outcome: "denied", reason: "workload_uid_mismatch" };
	if (assignment.podUid !== expectation.podUid) return { outcome: "denied", reason: "pod_mismatch" };

	// 3. A structurally valid assignment fails closed at its hard expiry boundary.
	if (!Number.isSafeInteger(expectation.nowEpochMs) || !Number.isSafeInteger(assignment.expiresAtEpochMs) || expectation.nowEpochMs >= assignment.expiresAtEpochMs)
	{
		return { outcome: "denied", reason: "expired" };
	}
	return { outcome: "trusted" };
}

/**
 * Starts a fresh attempt without minting a second logical AgentRun authority.
 * The read is advisory; the repository receives every observed service and revision coordinate again
 * so its atomic compare-and-swap closes concurrent retries and AgentService rollover races.
 * @param repository - Concurrency-capable run authority repository.
 * @param command - Compare-and-swap command carrying the observed attempt.
 * @returns Newly started attempt or a fail-closed conflict.
 */
export async function __StartNextRunAttempt(repository: AgentRunAuthorityRepository, command: StartNextRunAttemptCommand): Promise<StartNextRunAttemptResult>
{
	// 1. Validate the compare-and-swap input so malformed attempt counters never reach persistence.
	if (!command.runId.trim() || !Number.isSafeInteger(command.expectedAttempt) || command.expectedAttempt < 1 || !Number.isFinite(Date.parse(command.acceptedAt)))
	{
		return { outcome: "denied", reason: "invalid_command" };
	}

	// 2. Read run and service authority together so the domain never approves a stale independent read.
	const authority = await repository.getRunAuthority(command.runId);
	if (authority === null)
	{
		return { outcome: "denied", reason: "run_not_found" };
	}
	const { run } = authority;
	if (!_isRetryable(run))
	{
		return { outcome: "denied", reason: "run_not_terminal" };
	}
	if (authority.agentServiceState !== "active")
	{
		return { outcome: "denied", reason: "agent_service_inactive" };
	}
	if (authority.agentServiceSiloId !== run.siloId)
	{
		return { outcome: "denied", reason: "agent_service_silo_mismatch" };
	}
	if (authority.activeAgentRevisionId !== run.agentRevisionId)
	{
		return { outcome: "denied", reason: "agent_revision_superseded" };
	}

	// 3. Bind the atomic increment to both the run attempt and exact active service revision to close authority races.
	const result = await repository.startNextAttemptAtomically({
		...command,
		expectedAgentServiceId: run.agentServiceId,
		expectedAgentServiceSiloId: run.siloId,
		expectedAgentServiceState: "active",
		expectedActiveAgentRevisionId: run.agentRevisionId,
	});
	if (result.status === "not_found")
	{
		return { outcome: "denied", reason: "run_not_found" };
	}
	if (result.status === "attempt_conflict")
	{
		return { outcome: "denied", reason: "attempt_conflict", currentAttempt: result.currentAttempt };
	}
	if (result.status === "agent_service_authority_conflict")
	{
		if (result.currentAgentServiceSiloId !== run.siloId)
		{
			return { outcome: "denied", reason: "agent_service_silo_mismatch" };
		}
		return result.currentAgentServiceState === "active"
			? { outcome: "denied", reason: "agent_revision_superseded" }
			: { outcome: "denied", reason: "agent_service_inactive" };
	}
	return { outcome: "started", run: result.run };
}
