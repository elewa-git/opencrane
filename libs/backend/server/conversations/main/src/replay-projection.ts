import { AG_UI_A2UI_ENVELOPE_VERSION, AG_UI_CHILD_RUN_ENVELOPE_VERSION, type AgUiA2uiEnvelope, type AgUiChildRunEnvelope, type AgUiPublicEventPayload } from "@opencrane/contracts";

import type { ConversationReplayEventRow, ConversationReplayProjectionResult } from "./replay-projection.types.js";

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
	if (type === "tool.completed") return _Strings(payload, ["toolCallId"]);
	if (type === "run.failed" || type === "run.cancelled") return _Strings(payload, ["terminalReason", "failureCode"]);
	if (type === "conversation.message") return _Message(payload);
	if (type === "a2ui.surface.updated" || type === "a2ui.data_model.updated") return _A2ui(payload, conversationId, runId);
	if (type === "child.run.completed" || type === "child.run.failed" || type === "child.run.cancelled") return _ChildRun(type, payload, runId);
	return {};
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
	const envelope = payload["a2ui"];
	if (!_Record(envelope) || envelope["version"] !== AG_UI_A2UI_ENVELOPE_VERSION || envelope["conversationId"] !== conversationId || runId === null || envelope["runId"] !== runId || typeof envelope["messageId"] !== "string" || typeof envelope["surfaceId"] !== "string" || !Number.isSafeInteger(envelope["sequence"]) || !Array.isArray(envelope["operations"]) || _HasSecretField(envelope)) return {};
	if (!envelope["operations"].every(_A2uiOperation)) return {};
	return { a2ui: envelope as unknown as AgUiA2uiEnvelope };
}

/** Admit only the two frozen A2UI operation names and the exact component catalogue. */
function _A2uiOperation(value: unknown): boolean
{
	if (!_Record(value)) return false;
	if (_Record(value["dataModelUpdate"])) return Object.keys(value).length === 1;
	const update = value["surfaceUpdate"];
	if (!_Record(update) || !Array.isArray(update["components"]) || Object.keys(value).length !== 1) return false;
	return update["components"].every(function _Supported(component): boolean
	{
		if (!_Record(component) || !_Record(component["component"])) return false;
		const names = Object.keys(component["component"]);
		return names.length === 1 && ["Text", "Button", "TextField", "MultipleChoice", "Slider", "DateTimeInput", "Image", "Card", "List"].includes(names[0] ?? "");
	});
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

/** Reject credential-like field names recursively before a browser projection. */
function _HasSecretField(value: unknown): boolean
{
	if (Array.isArray(value)) return value.some(_HasSecretField);
	if (!_Record(value)) return false;
	return Object.entries(value).some(([key, nested]) => /secret|token|password|credential|authorization/iu.test(key) || _HasSecretField(nested));
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
