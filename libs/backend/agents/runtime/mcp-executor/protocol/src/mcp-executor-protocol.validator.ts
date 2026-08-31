import { z } from "zod";

import type { JsonValue } from "@opencrane/util";

/** Recursively accepts only values that can cross the executor's JSON boundary. */
const _JsonValueSchema: z.ZodType<JsonValue> = z.lazy(function _JsonValue(): z.ZodType<JsonValue>
{
	return z.union([z.null(), z.string(), z.boolean(), z.number().finite(), z.array(_JsonValueSchema), z.record(_JsonValueSchema)]);
});

const _AnnotationsSchema = z.object({
	audience: z.array(z.enum(["user", "assistant"])).optional(),
	priority: z.number().optional(),
	lastModified: z.string().optional(),
}).strict();

const _MetaSchema = z.record(_JsonValueSchema);

const _IconSchema = z.object({
	src: z.string().min(1),
	mimeType: z.string().min(1).optional(),
	sizes: z.array(z.string().min(1)).optional(),
	theme: z.enum(["light", "dark"]).optional(),
}).strict();

const _TextContentSchema = z.object({ type: z.literal("text"), text: z.string(), annotations: _AnnotationsSchema.optional(), _meta: _MetaSchema.optional() }).strict();

const _ImageContentSchema = z.object({ type: z.literal("image"), data: z.string(), mimeType: z.string().min(1), annotations: _AnnotationsSchema.optional(), _meta: _MetaSchema.optional() }).strict();

const _AudioContentSchema = z.object({ type: z.literal("audio"), data: z.string(), mimeType: z.string().min(1), annotations: _AnnotationsSchema.optional(), _meta: _MetaSchema.optional() }).strict();

const _ResourceLinkSchema = z.object({
	type: z.literal("resource_link"),
	name: z.string().min(1),
	uri: z.string().min(1),
	title: z.string().optional(),
	description: z.string().optional(),
	mimeType: z.string().min(1).optional(),
	icons: z.array(_IconSchema).optional(),
	size: z.number().int().nonnegative().optional(),
	annotations: _AnnotationsSchema.optional(),
	_meta: _MetaSchema.optional(),
}).strict();

const _TextResourceSchema = z.object({ uri: z.string().min(1), mimeType: z.string().min(1).optional(), text: z.string(), _meta: _MetaSchema.optional() }).strict();

const _BlobResourceSchema = z.object({ uri: z.string().min(1), mimeType: z.string().min(1).optional(), blob: z.string(), _meta: _MetaSchema.optional() }).strict();

const _EmbeddedResourceSchema = z.object({ type: z.literal("resource"), resource: z.union([_TextResourceSchema, _BlobResourceSchema]), annotations: _AnnotationsSchema.optional(), _meta: _MetaSchema.optional() }).strict();

const _ContentBlockSchema = z.discriminatedUnion("type", [_TextContentSchema, _ImageContentSchema, _AudioContentSchema, _ResourceLinkSchema, _EmbeddedResourceSchema]);

const _ToolInputSchema = z.record(_JsonValueSchema).refine(function _ObjectSchema(value): boolean { return value["type"] === "object"; });

/**
 * Returns whether a live tool input is one JSON Schema object.
 *
 * {@link __ParseMcpExecutorToolsListResponse} uses this check before returning a discovered tool.
 * @returns True when the value is a JSON object whose `type` field is `object`.
 * @see https://modelcontextprotocol.io/specification/2026-07-28
 */
export function _IsMcpExecutorToolInputSchema(value: unknown): value is Readonly<Record<string, JsonValue>>
{
	return _ToolInputSchema.safeParse(value).success;
}

/**
 * Checks MCP content blocks after the caller has enforced its response-byte limit.
 *
 * {@link __ParseMcpExecutorToolCallResponse} uses this check before it returns a tool result.
 * @returns At most 256 validated MCP 2026-07-28 content blocks, or null for a malformed value.
 * @see https://modelcontextprotocol.io/specification/2026-07-28
 */
export function _McpExecutorContentBlocks(value: unknown): readonly JsonValue[] | null
{
	const result = z.array(_ContentBlockSchema).max(256).safeParse(value);
	return result.success ? result.data as readonly JsonValue[] : null;
}
