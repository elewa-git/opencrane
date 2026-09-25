import { z } from "zod";

import type { JsonValue } from "@opencrane/util";

import { _IsMcpJsonValue } from "./mcp-json.validator";

/** Accepts metadata values that remain valid JSON within the shared protocol limits. */
const _JsonValueSchema = z.custom<JsonValue>(_IsMcpJsonValue);

/** Checks optional content annotations defined by MCP. */
const _AnnotationsSchema = z.object({
	audience: z.array(z.enum(["user", "assistant"])).optional(),
	priority: z.number().min(0).max(1).optional(),
	lastModified: z.string().optional(),
}).strict();

/** Checks extension metadata without accepting non-JSON values. */
const _MetaSchema = z.record(_JsonValueSchema);

/** Checks icons attached to a resource link. */
const _IconSchema = z.object({
	src: z.string().min(1),
	mimeType: z.string().min(1).optional(),
	sizes: z.array(z.string().min(1)).optional(),
	theme: z.enum(["light", "dark"]).optional(),
}).strict();

/** Checks one text content block. */
const _TextContentSchema = z.object({ type: z.literal("text"), text: z.string(), annotations: _AnnotationsSchema.optional(), _meta: _MetaSchema.optional() }).strict();

/** Checks one image content block. */
const _ImageContentSchema = z.object({ type: z.literal("image"), data: z.string(), mimeType: z.string().min(1), annotations: _AnnotationsSchema.optional(), _meta: _MetaSchema.optional() }).strict();

/** Checks one audio content block. */
const _AudioContentSchema = z.object({ type: z.literal("audio"), data: z.string(), mimeType: z.string().min(1), annotations: _AnnotationsSchema.optional(), _meta: _MetaSchema.optional() }).strict();

/** Checks one link to an MCP resource. */
const _ResourceLinkSchema = z.object({ type: z.literal("resource_link"), name: z.string().min(1), uri: z.string().min(1), title: z.string().optional(), description: z.string().optional(), mimeType: z.string().min(1).optional(), icons: z.array(_IconSchema).optional(), size: z.number().int().nonnegative().optional(), annotations: _AnnotationsSchema.optional(), _meta: _MetaSchema.optional() }).strict();

/** Checks the text variant of an embedded resource. */
const _TextResourceSchema = z.object({ uri: z.string().min(1), mimeType: z.string().min(1).optional(), text: z.string(), _meta: _MetaSchema.optional() }).strict();

/** Checks the binary variant of an embedded resource. */
const _BlobResourceSchema = z.object({ uri: z.string().min(1), mimeType: z.string().min(1).optional(), blob: z.string(), _meta: _MetaSchema.optional() }).strict();

/** Checks an embedded resource while requiring exactly one payload variant. */
const _EmbeddedResourceSchema = z.object({ type: z.literal("resource"), resource: z.union([_TextResourceSchema, _BlobResourceSchema]), annotations: _AnnotationsSchema.optional(), _meta: _MetaSchema.optional() }).strict();

/**
 * Selects every content block supported by this protocol contract.
 * @see https://modelcontextprotocol.io/specification/2026-07-28/schema — content blocks and their optional metadata.
 */
const _ContentBlockSchema = z.discriminatedUnion("type", [_TextContentSchema, _ImageContentSchema, _AudioContentSchema, _ResourceLinkSchema, _EmbeddedResourceSchema]);

/** Validates content blocks and returns the strict projected values. */
export function _ParseMcpContentBlocks(value: unknown): readonly JsonValue[] | null
{
	const result = z.array(_ContentBlockSchema).max(256).safeParse(value);
	return result.success ? result.data as readonly JsonValue[] : null;
}
