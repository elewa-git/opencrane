// This validator owns the immutable revision-authoring trust boundary: reviewed tool definitions
// and their JSON schemas must change together before any revision can be persisted or published.
import { Ajv } from "ajv";

import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { ReviewedIntegrationToolDefinition } from "./agent-revision.types.js";

/** Shared JSON-Schema compiler used only to establish revision-authoring validity. */
const _AJV = new Ajv({ allErrors: true, strict: false });

/** Return whether a value is a non-array JSON object. */
function _isObject(value: unknown): value is { readonly [key: string]: JsonValue }
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate one reviewed tool definition and its content digest.
 *
 * The root schema must explicitly describe an object because MCP tool arguments are named JSON
 * members. AJV compilation rejects malformed schemas and unresolved references; the canonical
 * digest check rejects a definition whose schema changed after review.
 */
export function __IsReviewedIntegrationToolDefinitionValid(definition: ReviewedIntegrationToolDefinition): boolean
{
	if (typeof definition?.name !== "string" || definition.name.trim().length === 0 || definition.name.includes(":")) return false;
	if (typeof definition.description !== "string" || definition.description.trim().length === 0) return false;
	if (!_isObject(definition.parametersSchema) || definition.parametersSchema["type"] !== "object") return false;
	if (typeof definition.parametersSchemaDigest !== "string") return false;
	if (___DigestCanonicalJson(definition.parametersSchema) !== definition.parametersSchemaDigest) return false;
	try
	{
		return _AJV.validateSchema(definition.parametersSchema as object) && Boolean(_AJV.compile(definition.parametersSchema as object));
	}
	catch
	{
		return false;
	}
}

/** Validate a complete non-empty integration tool catalogue with unique tool names. */
export function __AreReviewedIntegrationToolDefinitionsValid(definitions: readonly ReviewedIntegrationToolDefinition[]): boolean
{
	return definitions.length > 0
		&& definitions.every(__IsReviewedIntegrationToolDefinitionValid)
		&& new Set(definitions.map(function _Name(definition): string { return definition.name; })).size === definitions.length;
}
