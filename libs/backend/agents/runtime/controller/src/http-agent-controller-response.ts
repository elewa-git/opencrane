import type { AgentControllerRunAttemptAssignmentCommand, AgentControllerRunAttemptAssignmentResult, AgentControllerRunAttemptClaim, AgentControllerRunAttemptClaimLease, AgentControllerRunWorkloadRegistrationCommand, AgentControllerRunWorkloadRegistrationResult, AgentControllerRunWorkloadReleaseClaim } from "@opencrane/contracts";
import { ___ParseAndValidateJson } from "@opencrane/util";

const _MAX_RESPONSE_BYTES = 64 * 1024;

export function _IsAgentControllerIdentifier(value: unknown): value is string
{
	return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

function _IsPositiveInteger(value: unknown): value is number
{
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function _IsTime(value: unknown): value is string
{
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
	const epochMilliseconds = Date.parse(value);
	return Number.isSafeInteger(epochMilliseconds) && new Date(epochMilliseconds).toISOString() === value;
}

function _AsObject(value: unknown): Record<string, unknown> | null
{
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function _ReadAndValidateAgentControllerJson<T, TArguments extends readonly unknown[]>(response: Response, validate: (candidate: unknown, ...arguments_: TArguments) => T, ...validatorArguments: TArguments): Promise<T>
{
	const text = await _ReadBoundedText(response);
	return ___ParseAndValidateJson(text, "OpenCrane controller response", validate, ...validatorArguments);
}

async function _ReadBoundedText(response: Response): Promise<string>
{
	const declaredLength = response.headers.get("content-length");
	if (declaredLength !== null)
	{
		const parsedLength = Number(declaredLength);
		if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > _MAX_RESPONSE_BYTES)
		{
			await response.body?.cancel();
			throw new Error("OpenCrane controller response exceeded the 64 KiB boundary");
		}
	}
	if (response.body === null) throw new Error("OpenCrane controller returned no response body");
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	while (true)
	{
		const result = await reader.read();
		if (result.done) return Buffer.concat(chunks, byteLength).toString("utf8");
		byteLength += result.value.byteLength;
		if (byteLength > _MAX_RESPONSE_BYTES)
		{
			await reader.cancel();
			throw new Error("OpenCrane controller response exceeded the 64 KiB boundary");
		}
		chunks.push(result.value);
	}
}

function _ParseLease(value: unknown): AgentControllerRunAttemptClaimLease
{
	const lease = _AsObject(value);
	if (!lease || !_IsAgentControllerIdentifier(lease.eventId) || !_IsTime(lease.claimedAt) || !_IsPositiveInteger(lease.deliveryCount) || !_IsTime(lease.expiresAt) || Date.parse(lease.claimedAt) >= Date.parse(lease.expiresAt)) throw new Error("OpenCrane returned a malformed controller claim lease");
	return { eventId: lease.eventId, claimedAt: lease.claimedAt, deliveryCount: lease.deliveryCount, expiresAt: lease.expiresAt };
}

export function _ParseAgentControllerClaim(value: unknown): AgentControllerRunAttemptClaim
{
	const root = _AsObject(value);
	const attempt = _AsObject(root?.attempt);
	if (!root || !attempt || !_IsAgentControllerIdentifier(attempt.runId) || !_IsPositiveInteger(attempt.attempt) || !_IsAgentControllerIdentifier(attempt.siloId) || !_IsAgentControllerIdentifier(attempt.agentServiceId) || !_IsAgentControllerIdentifier(attempt.agentRevisionId) || !_IsAgentControllerIdentifier(attempt.inputSnapshotDigest) || !_IsAgentControllerIdentifier(attempt.namespace) || !_IsAgentControllerIdentifier(attempt.workloadProfile) || !_IsAgentControllerIdentifier(attempt.bootstrapReference) || !_IsAgentControllerIdentifier(attempt.litellmKey)) throw new Error("OpenCrane returned a malformed controller claim");
	return { lease: _ParseLease(root.lease), attempt: { runId: attempt.runId, attempt: attempt.attempt, siloId: attempt.siloId, agentServiceId: attempt.agentServiceId, agentRevisionId: attempt.agentRevisionId, inputSnapshotDigest: attempt.inputSnapshotDigest, namespace: attempt.namespace, workloadProfile: attempt.workloadProfile, bootstrapReference: attempt.bootstrapReference, litellmKey: attempt.litellmKey } };
}

export function _ParseAgentControllerWorkloadReleaseClaim(value: unknown): AgentControllerRunWorkloadReleaseClaim
{
	const root = _AsObject(value);
	const workload = _AsObject(root?.workload);
	if (!root || !workload || !_IsAgentControllerIdentifier(workload.runId) || !_IsPositiveInteger(workload.attempt) || !_IsAgentControllerIdentifier(workload.siloId) || !_IsAgentControllerIdentifier(workload.agentServiceId) || !_IsAgentControllerIdentifier(workload.agentRevisionId) || !_IsAgentControllerIdentifier(workload.namespace) || !_IsAgentControllerIdentifier(workload.serviceAccountName) || !_IsAgentControllerIdentifier(workload.workloadUid) || !_IsAgentControllerIdentifier(workload.workloadProfile) || !_IsTime(workload.assignmentExpiresAt) || !_IsAgentControllerIdentifier(workload.bootstrapReference)) throw new Error("OpenCrane returned a malformed workload-release claim");
	return { lease: _ParseLease(root.lease), workload: { runId: workload.runId, attempt: workload.attempt, siloId: workload.siloId, agentServiceId: workload.agentServiceId, agentRevisionId: workload.agentRevisionId, namespace: workload.namespace, serviceAccountName: workload.serviceAccountName, workloadUid: workload.workloadUid, workloadProfile: workload.workloadProfile, assignmentExpiresAt: workload.assignmentExpiresAt, bootstrapReference: workload.bootstrapReference } };
}

export function _ParseAgentControllerAssignmentResult(value: unknown, command: AgentControllerRunAttemptAssignmentCommand): AgentControllerRunAttemptAssignmentResult
{
	const root = _AsObject(value);
	if (!root || (root.outcome !== "assigned" && root.outcome !== "idempotent") || root.runId !== command.runId || root.attempt !== command.attempt || root.workloadUid !== command.workloadUid) throw new Error("OpenCrane returned a mismatched controller assignment result");
	return { outcome: root.outcome, runId: command.runId, attempt: command.attempt, workloadUid: command.workloadUid };
}

export function _ParseAgentControllerRegistrationResult(value: unknown, command: AgentControllerRunWorkloadRegistrationCommand): AgentControllerRunWorkloadRegistrationResult
{
	const root = _AsObject(value);
	if (!root || (root.outcome !== "registered" && root.outcome !== "idempotent") || root.runId !== command.runId || root.attempt !== command.attempt || root.workloadUid !== command.workloadUid || root.podUid !== command.podUid) throw new Error("OpenCrane returned a mismatched first-Pod registration result");
	return { outcome: root.outcome, runId: command.runId, attempt: command.attempt, workloadUid: command.workloadUid, podUid: command.podUid };
}

export function _ParseAgentControllerPrunedCount(value: unknown): number
{
	const root = _AsObject(value);
	if (!root || typeof root.deletedCount !== "number" || !Number.isSafeInteger(root.deletedCount) || root.deletedCount < 0 || root.deletedCount > 1_000) throw new Error("OpenCrane returned a malformed outbox-prune result");
	return root.deletedCount;
}
