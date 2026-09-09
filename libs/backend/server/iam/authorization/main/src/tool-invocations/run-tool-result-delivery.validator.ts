import { ___CloneCanonicalJson, ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { ReadRunToolResultCommand } from "./run-tool-result-delivery.types";
import { ToolInvocationStates } from "./tool-invocation-lifecycle.types";
import { ToolResultDeliveryOutcomes, type ToolInvocationRecord, type ToolResultDeliveryPayload } from "./tool-invocation.types";

/** Copy validated scalar coordinates before an asynchronous read can observe caller mutation. */
export function _CopyReadRunToolResultCommand(command: ReadRunToolResultCommand): ReadRunToolResultCommand | null
{
	const coordinates = { siloId: command.siloId, runId: command.runId, attempt: command.attempt, toolInvocationId: command.toolInvocationId, runtimeInstanceId: command.runtimeInstanceId, commandId: command.commandId, requestFingerprint: command.requestFingerprint };
	if (!Number.isSafeInteger(coordinates.attempt) || coordinates.attempt < 1
		|| ![coordinates.siloId, coordinates.runId, coordinates.toolInvocationId, coordinates.runtimeInstanceId, coordinates.commandId].every(value => typeof value === "string" && value.length > 0 && value === value.trim())
		|| typeof coordinates.requestFingerprint !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(coordinates.requestFingerprint))
		return null;
	return coordinates;
}

/**
 * Accept a delivery only when its complete body and digest match the immutable terminal invocation.
 * The returned body is detached; extra fields, malformed JSON values and unsafe failure text fail
 * closed. Comparing the full expected body also checks its public invocation identity.
 */
export function _ReadExactRunToolResultPayload(invocation: ToolInvocationRecord, storedPayload: unknown, payloadDigest: string): ToolResultDeliveryPayload | null
{
	let expected: ToolResultDeliveryPayload;
	if (invocation.state === ToolInvocationStates.Succeeded && invocation.failureCode === null)
		expected = { toolInvocationId: invocation.toolInvocationId, outcome: ToolResultDeliveryOutcomes.Succeeded, result: invocation.result };
	else if (invocation.state === ToolInvocationStates.Failed && invocation.result === null && typeof invocation.failureCode === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(invocation.failureCode))
		expected = { toolInvocationId: invocation.toolInvocationId, outcome: ToolResultDeliveryOutcomes.Failed, failureCode: invocation.failureCode };
	else
		return null;
	try
	{
		if (___DigestCanonicalJson(storedPayload as JsonValue) !== payloadDigest || ___DigestCanonicalJson(expected as unknown as JsonValue) !== payloadDigest)
			return null;
		return ___CloneCanonicalJson(expected as unknown as JsonValue) as ToolResultDeliveryPayload;
	}
	catch
	{
		return null;
	}
}
