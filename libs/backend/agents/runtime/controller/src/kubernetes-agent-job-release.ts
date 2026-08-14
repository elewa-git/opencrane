import type { V1Job } from "@kubernetes/client-node";
import { __DeriveAgentRuntimeReleaseDeadlineSeconds } from "@opencrane/backend/agents/runtime/k8s-launcher";

import type { AgentControllerJobReleasePlan } from "./kubernetes-agent-job-release.types";

function _CanonicalUtcEpochMilliseconds(value: string): number
{
	const epochMilliseconds = Date.parse(value);
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isSafeInteger(epochMilliseconds) || new Date(epochMilliseconds).toISOString() !== value) throw new Error("agent-controller release requires one canonical UTC authority instant");
	return epochMilliseconds;
}

/**
 * Prove that an observed released Job cannot execute beyond the durable assignment expiry.
 *
 * A missing start time is acceptable only immediately after our own successful release patch,
 * where the patch's exact deadline is already known but Kubernetes has not yet scheduled a Pod.
 */
export function _AssertReleasedAgentRuntimeAssignmentDeadline(current: V1Job, assignmentExpiresAt: string, requiredDeadlineSeconds?: number): void
{
	const deadlineSeconds = current.spec?.activeDeadlineSeconds;
	if (!Number.isSafeInteger(deadlineSeconds) || (requiredDeadlineSeconds !== undefined && deadlineSeconds !== requiredDeadlineSeconds)) throw new Error("Kubernetes released the runtime Job with an unexpected assignment deadline");
	const startTime = current.status?.startTime;
	if (startTime === undefined)
	{
		if (requiredDeadlineSeconds === undefined) throw new Error("released runtime Job is missing the start time required to prove assignment expiry");
		return;
	}
	const assignmentExpiresAtEpochMilliseconds = _CanonicalUtcEpochMilliseconds(assignmentExpiresAt);
	if (!Number.isSafeInteger(startTime.getTime()) || startTime.getTime() + (deadlineSeconds! * 1_000) > assignmentExpiresAtEpochMilliseconds) throw new Error("released runtime Job can outlive its absolute assignment expiry");
}

/**
 * Produce the UID- and resource-version-fenced patch that releases one exact suspended Job.
 *
 * The deadline is calculated against both the durable assignment and the controller lease, so a
 * slow Kubernetes request cannot turn a previously valid assignment into a longer execution grant.
 */
export function _PlanAgentRuntimeJobRelease(current: V1Job, expected: V1Job, assignmentExpiresAt: string, releaseLeaseExpiresAt: string, requestTimeoutMilliseconds: number): AgentControllerJobReleasePlan
{
	const assignmentExpiresAtEpochMilliseconds = _CanonicalUtcEpochMilliseconds(assignmentExpiresAt);
	const releaseLeaseExpiresAtEpochMilliseconds = _CanonicalUtcEpochMilliseconds(releaseLeaseExpiresAt);
	const name = current.metadata?.name;
	const namespace = current.metadata?.namespace;
	const uid = current.metadata?.uid;
	const resourceVersion = current.metadata?.resourceVersion;
	const previousDeadline = current.spec?.activeDeadlineSeconds;
	if (!name || !namespace || !uid || !resourceVersion) throw new Error("assigned runtime Job is missing identity for conditional release");
	if (!Number.isSafeInteger(previousDeadline)) throw new Error("assigned runtime Job is missing its profile deadline");
	const releaseUpperBoundEpochMilliseconds = Math.max(Date.now(), releaseLeaseExpiresAtEpochMilliseconds) + requestTimeoutMilliseconds;
	const activeDeadlineSeconds = __DeriveAgentRuntimeReleaseDeadlineSeconds(assignmentExpiresAt, releaseUpperBoundEpochMilliseconds, previousDeadline!);
	const maximumDeadline = expected.spec?.activeDeadlineSeconds;
	if (!Number.isSafeInteger(maximumDeadline) || activeDeadlineSeconds > maximumDeadline!) throw new Error("agent-controller release deadline exceeds the assigned runtime profile");
	return {
		activeDeadlineSeconds,
		canonicalAssignmentExpiresAt: new Date(assignmentExpiresAtEpochMilliseconds).toISOString(),
		patch: { name, namespace, body: [
			{ op: "test", path: "/metadata/uid", value: uid },
			{ op: "test", path: "/metadata/resourceVersion", value: resourceVersion },
			{ op: "test", path: "/spec/suspend", value: true },
			{ op: "test", path: "/spec/activeDeadlineSeconds", value: previousDeadline! },
			{ op: "replace", path: "/spec/activeDeadlineSeconds", value: activeDeadlineSeconds },
			{ op: "replace", path: "/spec/suspend", value: false },
		] },
	};
}
