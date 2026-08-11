import { ___ParseAgUiA2uiEnvelope } from "@opencrane/contracts";
import { RunEventTypes } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

import { RuntimeRunFailureReasons } from "./runtime-event-reporter.types.js";

const _SECRET_FIELD = /token|secret|password|authorization|cookie|credential|proof|private.?key/iu;
const _ERROR_TYPES = new Set(["AuthenticationError", "ConnectionError", "HTTPError", "ModelLoopError", "OSError", "PermissionError", "RuntimeError", "TimeoutError", "URLError", "ValueError"]);
const _RUN_ERROR_REASONS = new Set(["invalid_tool_result", "malformed_tool_call", "model_loop_error", "unknown_tool_result"]);
const _RUN_FAILURE_REASONS = new Set<string>(Object.values(RuntimeRunFailureReasons));
const _A2UI_EVENT_TYPES = new Set<string>([RunEventTypes.A2uiRenderingBegun, RunEventTypes.A2uiSurfaceUpdated, RunEventTypes.A2uiDataModelUpdated]);

/** Enforce global bounds and the exact public payload shape of one runtime-owned event. */
export function _RuntimeEventPayloadIsSafe(eventType: string, payload: JsonValue): boolean
{
	if (!_Bounded(payload) || !_Record(payload)) return false;
	switch (eventType)
	{
		case RunEventTypes.RunStarted: return _Exact(payload, ["promptCompilerVersion"]) && _Identifier(payload["promptCompilerVersion"]);
		case RunEventTypes.RunResumed: return _Exact(payload, ["inputGeneration"]) && _Counter(payload["inputGeneration"]);
		case RunEventTypes.MessageStarted: return _Exact(payload, ["messageId", "role"]) && _Identifier(payload["messageId"]) && payload["role"] === "assistant";
		case RunEventTypes.MessageDelta: return _Exact(payload, ["messageId", "delta"]) && _Identifier(payload["messageId"]) && typeof payload["delta"] === "string";
		case RunEventTypes.MessageCompleted: return _Exact(payload, ["messageId"]) && _Identifier(payload["messageId"]);
		case RunEventTypes.ToolRequested: return _Exact(payload, ["toolCallId", "toolCallName"]) && _Identifier(payload["toolCallId"]) && _Identifier(payload["toolCallName"]);
		case RunEventTypes.RunUsage: return _Exact(payload, ["inputTokens", "outputTokens"]) && _Counter(payload["inputTokens"]) && _Counter(payload["outputTokens"]);
		case RunEventTypes.RunError: return _Failure(payload, _RUN_ERROR_REASONS);
		// The three A2UI events all carry the same wrapper, so one check covers them.
		case RunEventTypes.A2uiRenderingBegun:
		case RunEventTypes.A2uiSurfaceUpdated:
		case RunEventTypes.A2uiDataModelUpdated: return _A2ui(payload);
		case RunEventTypes.RunCompleted: return _Exact(payload, []);
		case RunEventTypes.RunFailed: return _Failure(payload, _RUN_FAILURE_REASONS);
		default: return false;
	}
}

/**
 * Checks a failure payload: a `reason` from the list the caller passes, and nothing else required.
 *
 * An `errorType` key may also appear, and if it does it must be one of the names in `_ERROR_TYPES`.
 * Both lists are closed on purpose — a free-text reason or error name is how a provider message or a
 * stack trace would leak into a payload that the UI shows.
 */
function _Failure(payload: Readonly<Record<string, JsonValue>>, reasons: ReadonlySet<string>): boolean
{
	if (!_Exact(payload, ["reason"], ["errorType"]) || typeof payload["reason"] !== "string" || !reasons.has(payload["reason"])) return false;
	if (payload["errorType"] !== undefined && (typeof payload["errorType"] !== "string" || !_ERROR_TYPES.has(payload["errorType"]))) return false;
	return true;
}

/**
 * Checks that an A2UI payload holds nothing but an `a2ui` key, and that the contracts package accepts
 * what is inside it.
 *
 * The parse is the real check, and it throws rather than returning a result, so it is wrapped here.
 * @see ___ParseAgUiA2uiEnvelope
 */
function _A2ui(payload: Readonly<Record<string, JsonValue>>): boolean
{
	if (!_Exact(payload, ["a2ui"])) return false;
	try { ___ParseAgUiA2uiEnvelope(payload["a2ui"]); return true; }
	catch { return false; }
}

/**
 * Applies the limits that every payload must meet, whatever its event type.
 *
 * Walks the whole value and rejects it if: the JSON text is over 32 KB, objects nest more than 12
 * deep, any array holds more than 256 items, any string is longer than 16 KB, or any key name looks
 * like it holds a secret. The size and depth caps stop one event from filling the table or from
 * costing too much to walk; the key-name check is a last line of defence against a credential being
 * copied into an event the UI will show.
 */
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

/** Returns whether the payload is a plain object, so it is neither an array nor a bare value. */
function _Record(value: JsonValue): value is Readonly<Record<string, JsonValue>> { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** Returns whether the value is a non-empty string of at most 256 characters, the shape used for every id and name. */
function _Identifier(value: JsonValue | undefined): value is string { return typeof value === "string" && value.length > 0 && value.length <= 256; }
/** Returns whether the value is a whole number from zero up to the largest 32-bit signed integer, so it fits an int column. */
function _Counter(value: JsonValue | undefined): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647; }

/**
 * Checks the payload's key names against one event type's allowance.
 *
 * Every key in `required` must be present, and no key may appear that is not in `required` or
 * `optional`. Unknown keys are refused rather than ignored, so an extra field the runtime invents
 * cannot ride along into the database.
 */
function _Exact(payload: Readonly<Record<string, JsonValue>>, required: readonly string[], optional: readonly string[] = []): boolean
{
	const keys = Object.keys(payload);
	return required.every(function _Present(key) { return Object.hasOwn(payload, key); }) && keys.every(function _Known(key) { return required.includes(key) || optional.includes(key); });
}
