import { Ajv } from "ajv";

import { ___CloneCanonicalJson, type JsonValue } from "@opencrane/util";

import type { DeferredToolApprovalProjection } from "./deferred-tool-approval-interrupt.types.js";

/** JSON object used while deriving a display-safe decision schema. */
type JsonObject = { readonly [key: string]: JsonValue };

/** Fields that can contain an example or default secret value and must never reach an actor. */
const _SECRET_VALUE_KEYWORDS = new Set(["const", "default", "enum", "example", "examples"]);

/** Return whether a JSON value is a non-array object. */
function _isObject(value: JsonValue): value is JsonObject
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Return whether this schema node explicitly marks the corresponding value as secret. */
function _isSecretSchema(schema: JsonValue): boolean
{
	if (!_isObject(schema)) return false;
	return schema["writeOnly"] === true || schema["sensitive"] === true || schema["secret"] === true || schema["x-sensitive"] === true || schema["x-secret"] === true || schema["format"] === "password";
}

/** Resolve one local JSON Pointer reference; external or malformed references fail closed. */
function _resolveLocalReference(root: JsonValue, reference: string): JsonValue | null
{
	if (!reference.startsWith("#/")) return null;
	let current: JsonValue = root;
	for (const encoded of reference.slice(2).split("/"))
	{
		const segment = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
		if (!_isObject(current) || current[segment] === undefined) return null;
		current = current[segment]!;
	}
	return current;
}

/** Look for secret markings anywhere in the schema, following local `$ref` links and `allOf`/`anyOf`/`oneOf` branches; a reference that cannot be resolved counts as secret. */
function _containsSecretSchema(schema: JsonValue, root: JsonValue, visitedReferences = new Set<string>()): boolean
{
	if (Array.isArray(schema)) return schema.some(entry => _containsSecretSchema(entry, root, visitedReferences));
	if (!_isObject(schema)) return false;
	if (_isSecretSchema(schema)) return true;
	const reference = schema["$ref"];
	if (typeof reference === "string")
	{
		if (visitedReferences.has(reference)) return false;
		const resolved = _resolveLocalReference(root, reference);
		if (resolved === null) return true;
		const nextVisited = new Set(visitedReferences);
		nextVisited.add(reference);
		if (_containsSecretSchema(resolved, root, nextVisited)) return true;
	}
	for (const keyword of ["allOf", "anyOf", "oneOf"])
	{
		const branches = schema[keyword];
		if (Array.isArray(branches) && branches.some(branch => _containsSecretSchema(branch, root, new Set(visitedReferences)))) return true;
	}
	for (const keyword of ["properties", "$defs", "definitions"])
	{
		const nested = schema[keyword];
		if (_isObject(nested as JsonValue) && Object.values(nested as JsonObject).some(value => _containsSecretSchema(value, root, new Set(visitedReferences)))) return true;
	}
	for (const keyword of ["items", "additionalProperties"])
	{
		const nested = schema[keyword];
		if (nested !== undefined && _containsSecretSchema(nested, root, new Set(visitedReferences))) return true;
	}
	return false;
}

/** Strip the keywords in `_SECRET_VALUE_KEYWORDS` (`const`, `default`, `enum`, `example`, `examples`) from a secret schema, keeping the rest of its shape. */
function _safeSchema(schema: JsonValue, inheritedSecret = false): JsonValue
{
	if (Array.isArray(schema)) return schema.map(function _project(entry) { return _safeSchema(entry, inheritedSecret); });
	if (!_isObject(schema)) return schema;
	const secret = inheritedSecret || _isSecretSchema(schema);
	const projected: Record<string, JsonValue> = {};
	for (const [key, value] of Object.entries(schema))
	{
		if (secret && _SECRET_VALUE_KEYWORDS.has(key)) continue;
		projected[key] = _safeSchema(value, secret && key === "properties");
	}
	return projected;
}

/** Redact schema-marked secret values while retaining every non-secret proposed argument. */
function _safeArguments(value: JsonValue, schema: JsonValue): JsonValue
{
	if (_isSecretSchema(schema)) return null;
	if (Array.isArray(value))
	{
		const itemSchema = _isObject(schema) && schema["items"] !== undefined ? schema["items"] : {};
		return value.map(function _project(entry) { return _safeArguments(entry, itemSchema as JsonValue); });
	}
	if (!_isObject(value)) return value;
	const properties = _isObject(schema) && _isObject(schema["properties"] as JsonValue) ? schema["properties"] as JsonObject : {};
	const additional = _isObject(schema) && schema["additionalProperties"] !== undefined ? schema["additionalProperties"] : {};
	const projected: Record<string, JsonValue> = {};
	for (const [key, entry] of Object.entries(value))
	{
		const propertySchema = properties[key] ?? additional;
		if (_isSecretSchema(propertySchema as JsonValue)) continue;
		projected[key] = _safeArguments(entry, propertySchema as JsonValue);
	}
	return projected;
}

/** Build the exact actor response schema from one frozen reviewed parameters schema. */
function _responseSchema(parametersSchema: JsonValue): JsonValue
{
	return {
		oneOf: [
			{ type: "object", additionalProperties: false, required: ["decision", "arguments"], properties: { decision: { const: "approved" }, arguments: _safeSchema(parametersSchema) } },
			{ type: "object", additionalProperties: false, required: ["decision"], properties: { decision: { const: "denied" } } },
		],
	};
}

/**
 * Check one complete argument object against the tool's stored parameters schema.
 *
 * The schema is the one captured when the approval was opened, never the tool's current schema, so
 * a reviewer is always judged against what they were actually shown.
 *
 * Called by: ./deferred-tool-approval.ts (on the stored arguments and again on the reviewer's
 * replacement) and ./prisma-deferred-tool-approval-opener.ts.
 * @param parametersSchema - The stored JSON Schema.
 * @param argumentsValue - The complete argument object; partial edits are not supported.
 * @returns True when valid. False for invalid arguments AND for an unusable schema — the schema
 *   compile is wrapped in a try, so this never throws and always fails closed.
 */
export function __ValidateDeferredToolArguments(parametersSchema: JsonValue, argumentsValue: JsonValue): boolean
{
	try
	{
		const ajv = new Ajv({ allErrors: true, strict: false });
		return ajv.validate(parametersSchema as object | boolean, argumentsValue);
	}
	catch
	{
		return false;
	}
}

/**
 * Decide whether a reviewer may edit the arguments at all, or may only approve or deny.
 *
 * False as soon as any part of the schema marks a value secret — anywhere, including through local
 * `$ref`s and `allOf`/`anyOf`/`oneOf` branches. If a secret exists we cannot show the reviewer the
 * real arguments, so we must not accept a replacement either; they would be editing values they
 * never saw. An unresolvable or external `$ref` is also treated as secret, so an unreadable schema
 * fails closed.
 *
 * Called by: ./deferred-tool-approval.ts (`__DecideDeferredToolRequest`) and
 * `__ProjectDeferredToolApproval` below.
 * @param parametersSchema - The stored parameters schema.
 * @returns True when editing is safe, false when the reviewer may only approve or deny.
 */
export function __IsDeferredToolApprovalReplacementAllowed(parametersSchema: JsonValue): boolean
{
	return !_containsSecretSchema(parametersSchema, parametersSchema);
}

/** Builds the redacted proposed arguments and the decision-body schema shown to the approver. */
export function __ProjectDeferredToolApproval(parametersSchema: JsonValue, argumentsValue: JsonValue): DeferredToolApprovalProjection
{
	if (!__IsDeferredToolApprovalReplacementAllowed(parametersSchema))
	{
		return {
			proposedArguments: null,
			responseSchema: { oneOf: [{ type: "object", additionalProperties: false, required: ["decision"], properties: { decision: { const: "denied" } } }] },
		};
	}
	return {
		proposedArguments: ___CloneCanonicalJson(_safeArguments(argumentsValue, parametersSchema)),
		responseSchema: ___CloneCanonicalJson(_responseSchema(parametersSchema)),
	};
}
