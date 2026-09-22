import { z } from "zod";
import { ___CanonicalizeJson, ___ParseAndValidateJson, type JsonValue } from "@opencrane/util";

import { ConversationModelResponseKinds, type ConversationModelResponse, type ConversationModelToolCall, type ConversationModelToolExchange } from "./conversation-model.types";
import { ___ConversationModelPreForwardReceiptSchema } from "./conversation-model-retry.validator";

/**
 * These schemas turn remote declarations and saved tool history into the shared models.
 * They preserve the original strings, reject extra fields and malformed Unicode, and bound the
 * serialized content retained by the conversation owner. Change the models and schemas together.
 */

/** Bounds serialized custody and checks Unicode without converting or trimming the accepted value. */
function _boundedContent(value: unknown): boolean
{
	try { return new TextEncoder().encode(___CanonicalizeJson(value as JsonValue)).byteLength <= 65_536; }
	catch { return false; }
}

/** Rejects deep or excessive argument trees before recursive canonical JSON validation. */
function _validateArguments(candidate: unknown): void
{
	if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate))
		throw new Error("Tool arguments must be an object");
	const pending = [{ value: candidate as unknown, depth: 0 }];
	let visited = 0;
	while (pending.length > 0)
	{
		const current = pending.pop()!;
		if (++visited > 8_192 || current.depth > 16)
			throw new Error("Tool arguments exceed their structural bound");
		if (current.value !== null && typeof current.value === "object")
			for (const value of Object.values(current.value))
				pending.push({ value, depth: current.depth + 1 });
	}
	if (!_boundedContent(candidate))
		throw new Error("Tool arguments must contain bounded canonical JSON");
}

/** Requires an object argument body while preserving its original whitespace and key order. */
function _validArguments(value: string): boolean
{
	try { ___ParseAndValidateJson(value, "Conversation tool arguments", _validateArguments); return true; }
	catch { return false; }
}

/** Validates the complete saved declaration, not the tool's current permission or argument schema. */
export const ___ConversationModelToolCallSchema: z.ZodType<ConversationModelToolCall> = z.object({
	id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/u),
	name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u),
	arguments: z.string().max(65_536).refine(_validArguments),
	content: z.string().max(65_536).nullable(),
}).strict().refine(_boundedContent);

/** Bounds one ordered assistant/tool exchange to the private payload custody limit. */
export const ___ConversationModelToolExchangeSchema: z.ZodType<ConversationModelToolExchange> = z.object({
	call: ___ConversationModelToolCallSchema,
	resultContent: z.string().min(1).max(65_536),
}).strict().refine(_boundedContent);

/** Bounds and orders the complete saved assistant/tool history sent to one model request. */
export const ___ConversationModelToolHistorySchema: z.ZodType<readonly ConversationModelToolExchange[]> = z.array(___ConversationModelToolExchangeSchema).max(128).superRefine(function _UniqueProviderCalls(history, context)
{
	try
	{
		if (new TextEncoder().encode(___CanonicalizeJson(history as unknown as JsonValue)).byteLength > 1024 * 1024)
			context.addIssue({ code: z.ZodIssueCode.custom, path: ["__bytes"], message: "Tool history exceeds the serialized request bound" });
	}
	catch
	{}
	const ids = new Set<string>();
	for (const [index, exchange] of history.entries())
	{
		if (ids.has(exchange.call.id))
			context.addIssue({ code: z.ZodIssueCode.custom, path: [index, "call", "id"], message: "Tool call ids must be unique within ordered history" });
		ids.add(exchange.call.id);
	}
});

/** Checks completed text using the existing answer byte limit without changing whitespace. */
function _validText(value: string): boolean
{
	try
	{
		___CanonicalizeJson(value);
		return value.trim().length > 0 && new TextEncoder().encode(value).byteLength <= 65_536;
	}
	catch { return false; }
}

/** Validates the accepted result kind and its complete payload; provider envelopes remain transport-owned. */
export const ___ConversationModelResponseSchema: z.ZodType<ConversationModelResponse> = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal(ConversationModelResponseKinds.Text), text: z.string().max(65_536).refine(_validText) }).strict(),
	z.object({ kind: z.literal(ConversationModelResponseKinds.Tool), call: ___ConversationModelToolCallSchema }).strict(),
	z.object({ kind: z.literal(ConversationModelResponseKinds.PreForwardRejected), receipt: ___ConversationModelPreForwardReceiptSchema }).strict(),
]);
