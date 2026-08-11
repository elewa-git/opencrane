import { ___ParseAgUiA2uiEnvelope } from "@opencrane/contracts";
import { RunEventTypes } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

const _SECRET_FIELD = /token|secret|password|authorization|cookie|credential|proof|private.?key/iu;
const _ERROR_TYPES = new Set(["AuthenticationError", "ConnectionError", "HTTPError", "ModelLoopError", "OSError", "PermissionError", "RuntimeError", "TimeoutError", "URLError", "ValueError"]);
const _RUN_ERROR_REASONS = new Set(["invalid_tool_result", "malformed_tool_call", "model_loop_error", "unknown_tool_result"]);
const _RUN_FAILURE_REASONS = new Set(["executor_failed", "invalid_resume_steering", "invalid_tool_results", "missing_compiled_input", "missing_resume_payload"]);
const _A2UI_EVENT_TYPES = new Set<string>([RunEventTypes.A2uiRenderingBegun, RunEventTypes.A2uiSurfaceUpdated, RunEventTypes.A2uiDataModelUpdated]);

/** Enforce global bounds and the exact public payload shape of one runtime-owned event. */
export function _RuntimeEventPayloadIsSafe(eventType: string, payload: JsonValue): boolean
{
	if (!_Bounded(payload) || !_Record(payload)) return false;
	if (eventType === RunEventTypes.RunStarted) return _Exact(payload, ["promptCompilerVersion"]) && _Identifier(payload["promptCompilerVersion"]);
	if (eventType === RunEventTypes.RunResumed) return _Exact(payload, ["inputGeneration"]) && _Counter(payload["inputGeneration"]);
	if (eventType === RunEventTypes.MessageStarted) return _Exact(payload, ["messageId", "role"]) && _Identifier(payload["messageId"]) && payload["role"] === "assistant";
	if (eventType === RunEventTypes.MessageDelta) return _Exact(payload, ["messageId", "delta"]) && _Identifier(payload["messageId"]) && typeof payload["delta"] === "string";
	if (eventType === RunEventTypes.MessageCompleted) return _Exact(payload, ["messageId"]) && _Identifier(payload["messageId"]);
	if (eventType === RunEventTypes.ToolRequested) return _Exact(payload, ["toolCallId", "toolCallName"]) && _Identifier(payload["toolCallId"]) && _Identifier(payload["toolCallName"]);
	if (eventType === RunEventTypes.RunUsage) return _Exact(payload, ["inputTokens", "outputTokens"]) && _Counter(payload["inputTokens"]) && _Counter(payload["outputTokens"]);
	if (eventType === RunEventTypes.RunError) return _Failure(payload, _RUN_ERROR_REASONS);
	if (_A2UI_EVENT_TYPES.has(eventType)) return _A2ui(payload);
	if (eventType === RunEventTypes.RunCompleted) return _Exact(payload, []);
	if (eventType === RunEventTypes.RunFailed) return _Failure(payload, _RUN_FAILURE_REASONS);
	return false;
}

/** Validate one fixed failure vocabulary while preserving only optional bounded coordinates. */
function _Failure(payload: Readonly<Record<string, JsonValue>>, reasons: ReadonlySet<string>): boolean
{
	if (!_Exact(payload, ["reason"], ["errorType"]) || typeof payload["reason"] !== "string" || !reasons.has(payload["reason"])) return false;
	if (payload["errorType"] !== undefined && (typeof payload["errorType"] !== "string" || !_ERROR_TYPES.has(payload["errorType"]))) return false;
	return true;
}

/** Require the one exact A2UI wrapper and an upstream-valid governed envelope. */
function _A2ui(payload: Readonly<Record<string, JsonValue>>): boolean
{
	if (!_Exact(payload, ["a2ui"])) return false;
	try { ___ParseAgUiA2uiEnvelope(payload["a2ui"]); return true; }
	catch { return false; }
}

/** Enforce byte, depth, collection, string, and secret-shaped-key bounds recursively. */
function _Bounded(payload: JsonValue): boolean
{
	if (JSON.stringify(payload).length > 32_768) return false;
	function _Visit(value: JsonValue, depth: number): boolean
	{
		if (depth > 12) return false;
		if (Array.isArray(value)) return value.length <= 256 && value.every(function _Safe(item) { return _Visit(item, depth + 1); });
		if (value === null || typeof value !== "object") return typeof value !== "string" || value.length <= 16_384;
		return Object.entries(value).every(function _Safe(entry) { return !_SECRET_FIELD.test(entry[0]) && _Visit(entry[1], depth + 1); });
	}
	return _Visit(payload, 0);
}

function _Record(value: JsonValue): value is Readonly<Record<string, JsonValue>> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function _Identifier(value: JsonValue | undefined): value is string { return typeof value === "string" && value.length > 0 && value.length <= 256; }
function _Counter(value: JsonValue | undefined): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647; }

/** Require every key to belong to the event-specific contract, with all required keys present. */
function _Exact(payload: Readonly<Record<string, JsonValue>>, required: readonly string[], optional: readonly string[] = []): boolean
{
	const keys = Object.keys(payload);
	return required.every(function _Present(key) { return Object.hasOwn(payload, key); }) && keys.every(function _Known(key) { return required.includes(key) || optional.includes(key); });
}
