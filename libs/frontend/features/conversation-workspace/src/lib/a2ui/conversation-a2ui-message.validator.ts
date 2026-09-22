// History payloads are authorised plaintext, not trusted UI instructions. This strict subset of
// the installed A2UI v0.8 model must change alongside its adjacent display-message types.
import { z } from "zod";

import type { ConversationA2uiComponent, ConversationA2uiMessage, ConversationA2uiValueMap } from "./conversation-a2ui-message.types";

/** The installed protocol's standard catalogue is an identifier, never a URL to fetch. */
export const CONVERSATION_A2UI_CATALOGUE = "https://a2ui.org/specification/v0_8/standard_catalog_definition.json";
/** Bounds both a single history payload and its JSON parse allocation. */
export const CONVERSATION_A2UI_PAYLOAD_BYTES = 65_536;
/** Bounds component storage and the expanded tree, including repeated child references. */
export const CONVERSATION_A2UI_COMPONENT_LIMIT = 256;
/** Bounds layout nesting independently of the number of stored components. */
export const CONVERSATION_A2UI_DEPTH_LIMIT = 16;

/** Rejects blank and control-character identifiers before the SDK can use them. */
const _Id = z.string().min(1).max(128).regex(/^[^\u0000-\u001f\u007f]+$/u);
/** Restricts data references to explicit slash paths; no property or prototype traversal aliases. */
const _Path = z.string().max(512).regex(/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/u).refine(function _SafePath(value) { return value.split("/").every(part => !_UnsafeKey(part)); });
/** Only one literal string or absolute binding is admitted. */
const _TextValue = z.union([z.object({ literalString: z.string().max(16_384) }).strict(), z.object({ path: _Path }).strict()]);
/** Uses the standard static child representation without template expansion. */
const _Children = z.object({ explicitList: z.array(_Id).max(64) }).strict();
/** Standard layout options map to renderer-owned finite styles. */
const _Layout = z.object({ children: _Children, distribution: z.enum(["start", "center", "end", "spaceBetween", "spaceAround", "spaceEvenly"]).optional(), alignment: z.enum(["start", "center", "end", "stretch"]).optional() }).strict();
/** A finite catalogue excludes forms, actions, media, custom components, and arbitrary styling. */
const _Component: z.ZodType<ConversationA2uiComponent> = z.object({
	id: _Id, weight: z.number().finite().positive().max(100).optional(),
	component: z.union([
		z.object({ Text: z.object({ text: _TextValue, usageHint: z.enum(["h1", "h2", "h3", "h4", "h5", "caption", "body"]).optional() }).strict() }).strict(),
		z.object({ Row: _Layout }).strict(), z.object({ Column: _Layout }).strict(),
		z.object({ Card: z.object({ child: _Id }).strict() }).strict(),
		z.object({ Divider: z.object({ axis: z.literal("horizontal").optional() }).strict() }).strict(),
	]),
}).strict();

/** Each typed data entry carries exactly one value; whole-JSON depth is checked before recursion. */
const _DataEntry: z.ZodType<ConversationA2uiValueMap> = z.lazy(function _Entry()
{
	return z.object({ key: z.string().min(1).max(128).regex(/^(?:[A-Za-z0-9_-]+|\.)$/u).refine(value => !_UnsafeKey(value)),
		valueString: z.string().max(16_384).refine(function _PlainSdkString(value)
		{
			// This SDK implicitly parses JSON-shaped strings and may log them on failure.
			const trimmed = value.trim();
			return !((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]")));
		}).optional(), valueNumber: z.number().finite().optional(),
		valueBoolean: z.boolean().optional(), valueMap: z.array(_DataEntry).max(64).optional(),
	}).strict().refine(function _OneValue(value) { return Object.keys(value).filter(key => key !== "key").length === 1; });
});
/** Rejects multiple operation keys instead of allowing ambiguous SDK processing order. */
const _Message: z.ZodType<ConversationA2uiMessage> = z.union([
	z.object({ beginRendering: z.object({ surfaceId: _Id, root: _Id, catalogId: z.literal(CONVERSATION_A2UI_CATALOGUE).optional() }).strict() }).strict(),
	z.object({ surfaceUpdate: z.object({ surfaceId: _Id, components: z.array(_Component).min(1).max(CONVERSATION_A2UI_COMPONENT_LIMIT) }).strict() }).strict(),
	z.object({ dataModelUpdate: z.object({ surfaceId: _Id, path: _Path.optional(), contents: z.array(_DataEntry).max(64) }).strict() }).strict(),
	z.object({ deleteSurface: z.object({ surfaceId: _Id }).strict() }).strict(),
]);
/** A history entry batches official messages rather than introducing another component protocol. */
const _Batch = z.array(_Message).min(1).max(64);

/**
 * Decodes one bounded JSON-array payload and binds every operation to its history entry's display.
 * Unknown fields fail closed. No parser error or raw payload should be shown to the participant.
 * @throws Error if framing, size, depth, catalogue, data keys, or display coordinates are invalid.
 * @see https://a2ui.org/specification/v0.8-a2ui/ — the protocol implemented by the installed SDK.
 */
export function _ParseConversationA2uiMessages(payload: string, surfaceId: string): ConversationA2uiMessage[]
{
	if (payload.length > CONVERSATION_A2UI_PAYLOAD_BYTES || new TextEncoder().encode(payload).length > CONVERSATION_A2UI_PAYLOAD_BYTES)
		throw new Error("Structured display exceeds its payload limit");
	const value: unknown = JSON.parse(payload);
	_BoundJson(value);
	const messages = _Batch.parse(value);
	for (const message of messages)
	{
		const operation = message.beginRendering ?? message.surfaceUpdate ?? message.dataModelUpdate ?? message.deleteSurface;
		if (operation?.surfaceId !== surfaceId)
			throw new Error("Structured display coordinates do not match");
		const ids = message.surfaceUpdate?.components.map(component => component.id) ?? [];
		if (new Set(ids).size !== ids.length)
			throw new Error("Structured display contains duplicate components");
		if (message.dataModelUpdate)
		{
			_AssertUniqueDataKeys(message.dataModelUpdate.contents);
			const update = message.dataModelUpdate;
			if ((update.path === undefined || update.path === "/") && update.contents[0]?.key === "." && !update.contents[0].valueMap)
				throw new Error("Structured display root data must be a map");
		}
	}
	return messages;
}

/** Bounds parser traversal before recursive schemas or SDK data conversion run. */
function _BoundJson(value: unknown): void
{
	const pending = [{ value, depth: 0 }];
	let count = 0;
	while (pending.length > 0)
	{
		const current = pending.pop()!;
		if (++count > 8_192 || current.depth > CONVERSATION_A2UI_DEPTH_LIMIT)
			throw new Error("Structured display exceeds its nesting limit");
		if (current.value !== null && typeof current.value === "object")
			for (const child of Object.values(current.value))
				pending.push({ value: child, depth: current.depth + 1 });
	}
}

/** Rejects names that could acquire object-prototype meaning inside third-party data traversal. */
function _UnsafeKey(value: string): boolean
{
	return value === "__proto__" || value === "prototype" || value === "constructor";
}

/** Duplicate keys and mixed dot-value maps would otherwise silently replace data in the SDK. */
function _AssertUniqueDataKeys(entries: readonly ConversationA2uiValueMap[]): void
{
	if (new Set(entries.map(entry => entry.key)).size !== entries.length || (entries.some(entry => entry.key === ".") && entries.length !== 1))
		throw new Error("Structured display data keys are ambiguous");
	for (const entry of entries)
		if (entry.valueMap)
			_AssertUniqueDataKeys(entry.valueMap);
}
