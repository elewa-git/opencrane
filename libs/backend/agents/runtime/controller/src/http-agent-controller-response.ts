import type { AgentControllerRunAttemptAssignmentCommand, AgentControllerRunAttemptAssignmentResult, AgentControllerRunAttemptClaim, AgentControllerRunAttemptClaimLease, AgentControllerRunWorkloadRegistrationCommand, AgentControllerRunWorkloadRegistrationResult, AgentControllerRunWorkloadReleaseClaim } from "@opencrane/contracts";
import { ___IsBoundedIdentifier, ___ParseAndValidateJson, ___ParseShape, ___RequireField, ___ShapeFields } from "@opencrane/util";

/** Maximum JSON response accepted from one internal controller authority call. */
const _MAX_RESPONSE_BYTES = 64 * 1024;

/** Validate one bounded opaque identifier returned by the internal controller authority. */
export function _IsAgentControllerIdentifier(value: unknown): value is string
{
	return ___IsBoundedIdentifier(value);
}

/** Return whether the value is the bounded non-negative count an outbox prune may report. */
function _IsPrunedCount(value: unknown): value is number
{
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000;
}

/** Read a response under the fixed byte ceiling before applying its endpoint-specific validator. */
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

/** Parse the shared claim lease, refusing a lease that expires at or before its claim instant. */
function _ParseLease(value: unknown, path: string): AgentControllerRunAttemptClaimLease
{
	const lease = ___ParseShape(value, path, { eventId: ___ShapeFields.identifier, claimedAt: ___ShapeFields.instant, deliveryCount: ___ShapeFields.positiveInteger, expiresAt: ___ShapeFields.instant });
	if (Date.parse(lease.claimedAt) >= Date.parse(lease.expiresAt)) throw new Error(`${path} must expire after it is claimed`);
	return lease;
}

/** Parse one durable runtime-attempt claim without accepting untyped response fields. */
export function _ParseAgentControllerClaim(value: unknown): AgentControllerRunAttemptClaim
{
	return ___ParseShape(value, "controller claim", {
		lease: _ParseLease,
		attempt: function _parseAttempt(attempt: unknown, path: string)
		{
			return ___ParseShape(attempt, path, { runId: ___ShapeFields.identifier, attempt: ___ShapeFields.positiveInteger, siloId: ___ShapeFields.identifier, agentServiceId: ___ShapeFields.identifier, agentRevisionId: ___ShapeFields.identifier, inputSnapshotDigest: ___ShapeFields.identifier, namespace: ___ShapeFields.identifier, workloadProfile: ___ShapeFields.identifier, bootstrapReference: ___ShapeFields.identifier, litellmKey: ___ShapeFields.identifier });
		},
	});
}

/** Parse one exact workload-release claim before it can reach the Kubernetes adapter. */
export function _ParseAgentControllerWorkloadReleaseClaim(value: unknown): AgentControllerRunWorkloadReleaseClaim
{
	return ___ParseShape(value, "workload-release claim", {
		lease: _ParseLease,
		workload: function _parseWorkload(workload: unknown, path: string)
		{
			return ___ParseShape(workload, path, { runId: ___ShapeFields.identifier, attempt: ___ShapeFields.positiveInteger, siloId: ___ShapeFields.identifier, agentServiceId: ___ShapeFields.identifier, agentRevisionId: ___ShapeFields.identifier, namespace: ___ShapeFields.identifier, serviceAccountName: ___ShapeFields.identifier, workloadUid: ___ShapeFields.identifier, workloadProfile: ___ShapeFields.identifier, assignmentExpiresAt: ___ShapeFields.instant, bootstrapReference: ___ShapeFields.identifier });
		},
	});
}

/** Confirm the assignment endpoint echoed the command's exact run, attempt, and workload UID. */
export function _ParseAgentControllerAssignmentResult(value: unknown, command: AgentControllerRunAttemptAssignmentCommand): AgentControllerRunAttemptAssignmentResult
{
	const root = _AsObject(value);
	if (!root || (root.outcome !== "assigned" && root.outcome !== "idempotent") || root.runId !== command.runId || root.attempt !== command.attempt || root.workloadUid !== command.workloadUid) throw new Error("OpenCrane returned a mismatched controller assignment result");
	return { outcome: root.outcome, runId: command.runId, attempt: command.attempt, workloadUid: command.workloadUid };
}

/** Confirm the first-Pod registration endpoint echoed the exact command and Pod UID. */
export function _ParseAgentControllerRegistrationResult(value: unknown, command: AgentControllerRunWorkloadRegistrationCommand): AgentControllerRunWorkloadRegistrationResult
{
	const root = _AsObject(value);
	if (!root || (root.outcome !== "registered" && root.outcome !== "idempotent") || root.runId !== command.runId || root.attempt !== command.attempt || root.workloadUid !== command.workloadUid || root.podUid !== command.podUid) throw new Error("OpenCrane returned a mismatched first-Pod registration result");
	return { outcome: root.outcome, runId: command.runId, attempt: command.attempt, workloadUid: command.workloadUid, podUid: command.podUid };
}

/** Parse the bounded count returned after maintenance removes delivered outbox records. */
export function _ParseAgentControllerPrunedCount(value: unknown): number
{
	return ___ParseShape(value, "outbox-prune result", { deletedCount: ___RequireField(_IsPrunedCount, "an integer between 0 and 1000") }).deletedCount;
}

/** Narrow one echoed result candidate to a plain JSON object. */
function _AsObject(value: unknown): Record<string, unknown> | null
{
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
