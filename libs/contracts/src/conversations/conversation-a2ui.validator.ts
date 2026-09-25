import { z } from "zod";
import { ___CanonicalizeJson, type JsonValue } from "@opencrane/util";

import type { ConversationA2uiBeginRendering, ConversationA2uiComponent, ConversationA2uiDisplay, ConversationA2uiLayout, ConversationA2uiSurfaceUpdate, ConversationA2uiTextValue } from "./conversation-a2ui.types";

// Model output and decrypted history are untrusted display instructions. These strict schemas
// share the read-only wire shape; the conversation owner separately checks graph and write authority.

/** Identifies the installed standard catalogue; callers must not fetch arbitrary catalogue URLs. */
export const CONVERSATION_A2UI_CATALOGUE = "https://a2ui.org/specification/v0_8/standard_catalog_definition.json";
/** Replaces model-selected display ownership until the conversation owner assigns an identifier. */
export const CONVERSATION_A2UI_SURFACE_PLACEHOLDER = "conversation-result";
/** Bounds one serialized display independently of its ordinary-text fallback. */
export const CONVERSATION_A2UI_PAYLOAD_BYTES = 65_536;
/** Bounds stored component definitions before the owner checks the expanded graph. */
export const CONVERSATION_A2UI_COMPONENT_LIMIT = 256;
/** Bounds the expanded graph checked by its producer and consumer owners. */
export const CONVERSATION_A2UI_DEPTH_LIMIT = 16;

/** Rejects malformed Unicode without changing accepted text. */
function _validUnicode(value: string): boolean
{
	try { ___CanonicalizeJson(value); return true; }
	catch { return false; }
}

/** Keeps identifiers nonblank and free of control characters. */
const _Id = z.string().min(1).max(128).regex(/^[^\u0000-\u001f\u007f]+$/u).refine(_validUnicode);
/** Admits consumer data paths without prototype traversal aliases. */
const _Path = z.string().max(512).regex(/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/u).refine(function _safePath(value)
{
	return value.split("/").every(part => !["__proto__", "prototype", "constructor"].includes(part));
});
/** Preserves escaped text, including whitespace, without allowing a binding. */
const _LiteralText = z.object({ literalString: z.string().max(16_384).refine(_validUnicode) }).strict();
/** Shares existing history binding support without granting it to generated answers. */
const _TextValue: z.ZodType<ConversationA2uiTextValue> = z.union([_LiteralText, z.object({ path: _Path }).strict()]);
/** Shares finite standard layout choices across producer and consumer validation. */
export const ___ConversationA2uiLayoutSchema: z.ZodType<ConversationA2uiLayout> = z.object({
	children: z.object({ explicitList: z.array(_Id).max(64) }).strict(),
	distribution: z.enum(["start", "center", "end", "spaceBetween", "spaceAround", "spaceEvenly"]).optional(),
	alignment: z.enum(["start", "center", "end", "stretch"]).optional(),
}).strict();

/** Builds the common component schema with the caller's explicit literal-or-binding choice. */
function _componentSchema(text: z.ZodType<ConversationA2uiTextValue>): z.ZodType<ConversationA2uiComponent>
{
	return z.object({ id: _Id, weight: z.number().finite().positive().max(100).optional(), component: z.union([
		z.object({ Text: z.object({ text, usageHint: z.enum(["h1", "h2", "h3", "h4", "h5", "caption", "body"]).optional() }).strict() }).strict(),
		z.object({ Row: ___ConversationA2uiLayoutSchema }).strict(),
		z.object({ Column: ___ConversationA2uiLayoutSchema }).strict(),
		z.object({ Card: z.object({ child: _Id }).strict() }).strict(),
		z.object({ Divider: z.object({ axis: z.literal("horizontal").optional() }).strict() }).strict(),
	]) }).strict();
}

/** Validates the shared component shape, including bindings used by existing history replay. */
export const ___ConversationA2uiComponentSchema = _componentSchema(_TextValue);
/** Validates generated components without bindings, templates or action-bearing extensions. */
export const ___ConversationA2uiLiteralComponentSchema = _componentSchema(_LiteralText);
/** Validates a history component update; its enclosing entry still owns its display identifier. */
export const ___ConversationA2uiSurfaceUpdateSchema: z.ZodType<ConversationA2uiSurfaceUpdate> = z.object({ surfaceId: _Id, components: z.array(___ConversationA2uiComponentSchema).min(1).max(CONVERSATION_A2UI_COMPONENT_LIMIT) }).strict();
/** Validates a root selection without accepting styles or a foreign catalogue. */
export const ___ConversationA2uiBeginRenderingSchema: z.ZodType<ConversationA2uiBeginRendering> = z.object({ surfaceId: _Id, root: _Id, catalogId: z.literal(CONVERSATION_A2UI_CATALOGUE).optional() }).strict();

/** Bounds canonical display bytes and rejects values that cannot be retained as valid JSON. */
function _boundedDisplay(value: unknown): boolean
{
	try { return new TextEncoder().encode(___CanonicalizeJson(value as JsonValue)).byteLength <= CONVERSATION_A2UI_PAYLOAD_BYTES; }
	catch { return false; }
}

/**
 * Admits a complete generated pair with reserved ownership and literal-only components.
 * The caller must still reject missing references, cycles and excessive expanded depth or size.
 */
export const ___ConversationA2uiDisplaySchema: z.ZodType<ConversationA2uiDisplay> = z.tuple([
	z.object({ surfaceUpdate: z.object({ surfaceId: z.literal(CONVERSATION_A2UI_SURFACE_PLACEHOLDER), components: z.array(___ConversationA2uiLiteralComponentSchema).min(1).max(CONVERSATION_A2UI_COMPONENT_LIMIT) }).strict() }).strict(),
	z.object({ beginRendering: z.object({ surfaceId: z.literal(CONVERSATION_A2UI_SURFACE_PLACEHOLDER), root: _Id, catalogId: z.literal(CONVERSATION_A2UI_CATALOGUE).optional() }).strict() }).strict(),
]).refine(_boundedDisplay);
