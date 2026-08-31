import { AGENT_RUNTIME_CONTINUATION_MAX_BYTES, AGENT_RUNTIME_CONTINUATION_VERSION, type RuntimeAttemptContinuation } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";

import type { ParsedRuntimeContinuation } from "./runtime-continuation.types";

/** Maximum number of characters in a protocol continuation identifier. */
export const RUNTIME_CONTINUATION_MAX_IDENTIFIER_CHARACTERS = 256;
/** Maximum pending correlations of each governed-work class. */
export const RUNTIME_CONTINUATION_MAX_PENDING_CORRELATIONS = 128;

/** Return whether a value is a bounded non-empty protocol identifier. */
function _IsIdentifier(value: unknown): value is string
{
	return typeof value === "string" && value.length > 0 && value.length <= RUNTIME_CONTINUATION_MAX_IDENTIFIER_CHARACTERS;
}

/** Return whether a value is a safe non-negative integer. */
function _IsCounter(value: unknown): value is number
{
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Validate unique pending tool correlations without interpreting framework identifiers. */
function _PendingToolsAreValid(value: unknown): value is RuntimeAttemptContinuation["pendingToolCalls"]
{
	if (!Array.isArray(value) || value.length > RUNTIME_CONTINUATION_MAX_PENDING_CORRELATIONS)
		return false;
	const toolIds = new Set<string>();
	const frameworkIds = new Set<string>();
	for (const item of value)
	{
		if (!item || typeof item !== "object" || Array.isArray(item))
			return false;
		const record = item as Record<string, unknown>;
		if (Object.keys(record).length !== 2 || !_IsIdentifier(record["toolInvocationId"]) || !_IsIdentifier(record["frameworkCallId"]))
			return false;
		if (toolIds.has(record["toolInvocationId"]) || frameworkIds.has(record["frameworkCallId"]))
			return false;
		toolIds.add(record["toolInvocationId"]);
		frameworkIds.add(record["frameworkCallId"]);
	}
	return true;
}

/** Validate unique pending elicitation correlations without accepting extra authority fields. */
function _PendingElicitationsAreValid(value: unknown): value is RuntimeAttemptContinuation["pendingElicitations"]
{
	if (!Array.isArray(value) || value.length > RUNTIME_CONTINUATION_MAX_PENDING_CORRELATIONS)
		return false;
	const requestKeys = new Set<string>();
	const frameworkIds = new Set<string>();
	for (const item of value)
	{
		if (!item || typeof item !== "object" || Array.isArray(item))
			return false;
		const record = item as Record<string, unknown>;
		const keys = Object.keys(record);
		if ((keys.length !== 2 && keys.length !== 3) || !_IsIdentifier(record["requestKey"]) || !_IsIdentifier(record["frameworkCallId"]))
			return false;
		if ("requestId" in record && !_IsIdentifier(record["requestId"]))
			return false;
		if (requestKeys.has(record["requestKey"]) || frameworkIds.has(record["frameworkCallId"]))
			return false;
		requestKeys.add(record["requestKey"]);
		frameworkIds.add(record["frameworkCallId"]);
	}
	return true;
}

/** Computes the RFC 8785 JSON digest that the Python runtime also writes into each continuation. */
export function __DigestRuntimeContinuation(continuation: Omit<RuntimeAttemptContinuation, "digest">): string
{
	return ___DigestCanonicalJson(continuation as never);
}

/**
 * Checks a plaintext continuation before encryption or after decryption.
 *
 * Returns null when fields, sizes, pending-call links, or the shared digest are invalid, so callers
 * cannot restore a partly understood document.
 */
export function __ParseRuntimeContinuation(value: unknown): ParsedRuntimeContinuation | null
{
	if (!value || typeof value !== "object" || Array.isArray(value))
		return null;
	const record = value as Record<string, unknown>;
	if (Object.keys(record).length !== 11 || record["version"] !== AGENT_RUNTIME_CONTINUATION_VERSION || !_IsCounter(record["revision"]) || record["revision"] < 1 || !_IsIdentifier(record["digest"]) || !_IsIdentifier(record["runId"]) || !_IsCounter(record["attempt"]) || !_IsCounter(record["inputGeneration"]) || !_IsCounter(record["appliedCommandSequence"]))
		return null;
	if (!record["compiledInput"] || typeof record["compiledInput"] !== "object" || Array.isArray(record["compiledInput"]) || !Array.isArray(record["modelMessages"]) || !_PendingToolsAreValid(record["pendingToolCalls"]) || !_PendingElicitationsAreValid(record["pendingElicitations"]))
		return null;
	const continuation = record as unknown as RuntimeAttemptContinuation;
	if (continuation.pendingToolCalls.length === 0 && continuation.pendingElicitations.length === 0)
		return null;
	const { digest: _ignoredDigest, ...covered } = continuation;
	if (!/^sha256:[0-9a-f]{64}$/.test(continuation.digest) || __DigestRuntimeContinuation(covered) !== continuation.digest)
		return null;
	const plaintext = Buffer.from(JSON.stringify(continuation), "utf8");
	return plaintext.length <= AGENT_RUNTIME_CONTINUATION_MAX_BYTES ? { continuation, plaintext } : null;
}
