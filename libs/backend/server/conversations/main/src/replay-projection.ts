import { AG_UI_CHILD_RUN_ENVELOPE_VERSION, AgUiToolRecoveryProviderOutcomes, ___ParseAgUiA2uiEnvelope, type AgUiChildRunEnvelope, type AgUiPublicEventPayload } from "@opencrane/contracts";

import type { ConversationReplayEventRow, ConversationReplayProjectionResult } from "./replay-projection.types.js";

const _SAFE_FAILURE_CODES = new Set(["AuthenticationError", "ConnectionError", "HTTPError", "ModelLoopError", "OSError", "PermissionError", "RuntimeError", "TimeoutError", "URLError", "ValueError", "invalid_deferred_result", "malformed_tool_call", "model_loop_error", "obot_invocation_failed", "tool_not_allowed", "unknown_tool", "unknown_tool_invocation"]);

/** Redact one canonical timeline row into only the fields the AG-UI projection contract allows. */
export function __ProjectConversationReplayEvent(row: ConversationReplayEventRow): ConversationReplayProjectionResult
{
	if (!row.cursor || !row.conversationId || !/^[1-9]\d*$/u.test(row.position) || !row.type || Number.isNaN(Date.parse(row.occurredAt))) return null;
	return { cursor: row.cursor, conversationId: row.conversationId, ...(row.runId === null ? {} : { runId: row.runId }), position: row.position, eventType: row.type, occurredAt: row.occurredAt, payload: _SafePayload(row.type, row.payload, row.conversationId, row.runId) };
}

/** Select only schema-free display fields needed by known projected event types. */
function _SafePayload(type: string, payload: Readonly<Record<string, unknown>>, conversationId: string, runId: string | null): AgUiPublicEventPayload
{
	if (type === "message.started" || type === "message.completed") return _Strings(payload, ["messageId"]);
	if (type === "message.delta") return _Strings(payload, ["messageId", "delta"]);
	if (type === "tool.requested") return _Strings(payload, ["toolCallId", "toolCallName"]);
	if (type === "tool.started" || type === "tool.completed") return _Tool(payload);
	if (type === "tool.failed") return _Failure(payload, true);
	if (type === "tool.recovery_required") return _ToolRecovery(payload);
	if (type === "run.error") return _Failure(payload, false);
	if (type === "run.failed" || type === "run.cancelled") return _Strings(payload, ["terminalReason", "failureCode"]);
	if (type === "conversation.message") return _Message(payload);
	if (type === "a2ui.rendering.begun" || type === "a2ui.surface.updated" || type === "a2ui.data_model.updated") return _A2ui(payload, conversationId, runId);
	if (type === "child.run.completed" || type === "child.run.failed" || type === "child.run.cancelled") return _ChildRun(type, payload, runId);
	return {};
}

/** Admit only fixed safe recovery evidence; provider bodies and arbitrary detail are discarded. */
function _ToolRecovery(payload: Readonly<Record<string, unknown>>): AgUiPublicEventPayload
{
	const expectedAttempt = payload["expectedAttempt"];
	const toolCallId = payload["toolCallId"] ?? payload["toolInvocationId"];
	const preparationRetryCount = payload["preparationRetryCount"];
	const preparationRetryLimit = payload["preparationRetryLimit"];
	const providerOutcome = payload["providerOutcome"];
	if (!Number.isSafeInteger(expectedAttempt) || (expectedAttempt as number) < 1 || typeof toolCallId !== "string" || !Number.isSafeInteger(preparationRetryCount) || (preparationRetryCount as number) < 0 || preparationRetryLimit !== 3) return {};
	if (providerOutcome !== undefined && !Object.values(AgUiToolRecoveryProviderOutcomes).includes(providerOutcome as AgUiToolRecoveryProviderOutcomes)) return {};
	return { toolRecovery: { eventType: "tool.recovery_required", expectedAttempt: expectedAttempt as number, toolCallId, recoveryCategory: "manual_action_required", preparationRetryCount: preparationRetryCount as number, preparationRetryLimit, ...(providerOutcome === undefined ? {} : { providerOutcome: providerOutcome as AgUiToolRecoveryProviderOutcomes }) } };
}

/** Select display-safe tool coordinates while retaining no result, arguments, or invocation detail. */
function _Tool(payload: Readonly<Record<string, unknown>>): AgUiPublicEventPayload
{
	const toolCallId = payload["toolCallId"] ?? payload["toolInvocationId"];
	return typeof toolCallId === "string" ? { toolCallId } : {};
}

/** Surface a bounded failure classification without forwarding provider messages or raw details. */
function _Failure(payload: Readonly<Record<string, unknown>>, tool: boolean): AgUiPublicEventPayload
{
	const candidateFailureCode = typeof payload["errorType"] === "string" ? payload["errorType"] : payload["reason"];
	const failureCode = typeof candidateFailureCode === "string" && _SAFE_FAILURE_CODES.has(candidateFailureCode) ? candidateFailureCode : undefined;
	const toolCallId = payload["toolCallId"] ?? payload["toolInvocationId"];
	return {
		...(tool && typeof toolCallId === "string" ? { toolCallId } : {}),
		...(failureCode === undefined ? {} : { failureCode })
	};
}

/** Select the text-only projection of one canonical ordinary message. */
function _Message(payload: Readonly<Record<string, unknown>>): AgUiPublicEventPayload
{
	const messageId = payload["messageId"];
	const role = payload["role"];
	const state = payload["state"];
	const blocks = payload["blocks"];
	if (typeof messageId !== "string" || !_MessageRole(role) || !_MessageState(state) || !Array.isArray(blocks)) return {};
	const text = blocks.flatMap(function _TextBlock(block): readonly string[]
	{
		if (!_Record(block) || block["kind"] !== "text" || typeof block["value"] !== "string") return [];
		return [block["value"]];
	}).join("\n");
	return { messageId, messageRole: role, messageState: state, ...(text.length === 0 ? {} : { messageText: text }) };
}

/** Admit only an already-versioned A2UI envelope with no secret-shaped field names. */
function _A2ui(payload: Readonly<Record<string, unknown>>, conversationId: string, runId: string | null): AgUiPublicEventPayload
{
	try
	{
		const envelope = ___ParseAgUiA2uiEnvelope(payload["a2ui"]);
		if (runId === null || envelope.conversationId !== conversationId || envelope.runId !== runId) return {};
		return { a2ui: envelope };
	}
	catch { return {}; }
}

/** Select direct-parent terminal child facts and discard all child context/output. */
function _ChildRun(type: string, payload: Readonly<Record<string, unknown>>, parentRunId: string | null): AgUiPublicEventPayload
{
	const childRunId = payload["childRunId"];
	const attempt = payload["childAttempt"];
	const finishedAt = payload["finishedAt"];
	if (parentRunId === null || typeof childRunId !== "string" || !Number.isSafeInteger(attempt) || typeof finishedAt !== "string" || Number.isNaN(Date.parse(finishedAt))) return {};
	const state = _ChildState(type);
	const terminalReason = payload["terminalReason"];
	const childRun: AgUiChildRunEnvelope = { version: AG_UI_CHILD_RUN_ENVELOPE_VERSION, parentRunId, childRunId, attempt: attempt as number, state, ...(typeof terminalReason === "string" ? { terminalReason } : {}), finishedAt };
	return { childRun };
}

function _Record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function _MessageRole(value: unknown): value is "assistant" | "user" | "system" | "tool" { return value === "assistant" || value === "user" || value === "system" || value === "tool"; }
function _MessageState(value: unknown): value is "pending" | "streaming" | "completed" | "failed" | "cancelled" { return value === "pending" || value === "streaming" || value === "completed" || value === "failed" || value === "cancelled"; }
function _ChildState(type: string): "completed" | "failed" | "cancelled"
{
	if (type.endsWith(".completed")) return "completed";
	if (type.endsWith(".failed")) return "failed";
	return "cancelled";
}

/** Copy named string values and drop every other canonical payload field. */
function _Strings(payload: Readonly<Record<string, unknown>>, names: readonly (keyof AgUiPublicEventPayload)[]): AgUiPublicEventPayload
{
	const result: Record<string, string> = {};
	for (const name of names)
	{
		const value = payload[name];
		if (typeof value === "string") result[name] = value;
	}
	return result;
}
