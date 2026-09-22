import { createHash, createHmac } from "node:crypto";
import { ConversationModelPreForwardContracts, ConversationModelPreForwardReasons, ConversationModelToolModes, type ConversationModelPreForwardReceipt, type ConversationModelRequest } from "@opencrane/contracts";
import { ___CanonicalizeJson, type JsonValue } from "@opencrane/util";

export const _RETRY_NOW = Date.parse("2026-09-22T12:00:00.000Z");
export const _RETRY_ENDPOINT = "http://testv6-opencrane-litellm:4000";

/** Supplies a synthetic attempt without opening any provider or proxy connection. */
export function _RetryRequest(overrides: Partial<ConversationModelRequest> = {}): ConversationModelRequest
{
	return {
		compiledInput: {
			promptCompilerVersion: "test-compiler", runId: "run-1", attempt: 1, instructions: "Private instructions.",
			messages: [{ role: "user", content: "Private question." }], tools: [],
			model: { modelAlias: "admitted-model", maxOutputTokens: 400, generatedOutputCapabilities: [] },
			budget: { maxModelTurns: 1, maxCompletionTokens: 300, maxCostUsdMicros: 1000, maxToolInvocations: 0, maxLoopIterations: 1, wallClockDeadlineEpochMs: _RETRY_NOW + 60_000 }, digest: "sha256:test",
		},
		endpoint: _RETRY_ENDPOINT, key: "sk-synthetic-attempt", modelAlias: "admitted-model", maxCompletionTokens: 200,
		notAfterEpochMs: _RETRY_NOW + 25_000, tools: ConversationModelToolModes.None, history: [],
		delivery: { physicalNonce: "a".repeat(64), logicalFence: "b".repeat(64) }, ...overrides,
	};
}

/** Matches the deployment-composed contract without changing any real environment variables. */
export function _RetryEnvironment(): Record<string, string>
{
	return { LITELLM_ENDPOINT: _RETRY_ENDPOINT, LITELLM_PREFORWARD_ENDPOINT: _RETRY_ENDPOINT, LITELLM_PREFORWARD_CONTRACT: ConversationModelPreForwardContracts.V1 };
}

/** Builds proof fields from the bytes and coordinates actually sent by the transport. */
export function _RetryReceipt(init: RequestInit, overrides: Partial<ConversationModelPreForwardReceipt> = {}): ConversationModelPreForwardReceipt
{
	const headers = new Headers(init.headers);
	return {
		version: ConversationModelPreForwardContracts.V1, reason: ConversationModelPreForwardReasons.LocalRateLimit,
		physicalNonce: headers.get("x-opencrane-request-nonce") ?? "a".repeat(64),
		logicalFence: headers.get("x-opencrane-logical-fence") ?? "b".repeat(64),
		requestBodySha256: createHash("sha256").update(String(init.body)).digest("hex"),
		deadlineEpochMs: Number(headers.get("x-opencrane-request-deadline") ?? _RETRY_NOW + 25_000),
		retryAtEpochMs: _RETRY_NOW + 1_000, ...overrides,
	};
}

/** Signs synthetic response fields so each consumer binding can be tested independently. */
export function _RetryAuthentication(receipt: ConversationModelPreForwardReceipt, rawKey = "sk-synthetic-attempt"): string
{
	const key = createHmac("sha256", rawKey).update("opencrane:preforward-receipt:key:v1").digest();
	return createHmac("sha256", key).update("opencrane:preforward-receipt:message:v1\0").update(___CanonicalizeJson(receipt as unknown as JsonValue)).digest("hex");
}

/** Creates a local streaming response; this fixture does not claim provider-side qualification. */
export function _RetryResponse(init: RequestInit, overrides: Partial<ConversationModelPreForwardReceipt> = {}): Response
{
	const receipt = _RetryReceipt(init, overrides);
	return new Response(JSON.stringify({ receipt }), { status: 429, headers: { "content-type": "application/json", "x-opencrane-preforward-receipt": _RetryAuthentication(receipt) } });
}
