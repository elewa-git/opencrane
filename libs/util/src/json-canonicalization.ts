import type { JsonValue } from "./json-canonicalization.types.js";

/** Maximum Unicode high-surrogate code unit. */
const HIGH_SURROGATE_MAX = 0xdbff;

/** Minimum Unicode high-surrogate code unit. */
const HIGH_SURROGATE_MIN = 0xd800;

/** Maximum Unicode low-surrogate code unit. */
const LOW_SURROGATE_MAX = 0xdfff;

/** Minimum Unicode low-surrogate code unit. */
const LOW_SURROGATE_MIN = 0xdc00;

/**
 * Rejects lone Unicode surrogates, which RFC 8785 requires parsers to reject.
 * @param value - String being prepared for canonical serialization.
 */
function _assertValidUnicode(value: string): void
{
	for (let index = 0; index < value.length; index += 1)
	{
		const codeUnit = value.charCodeAt(index);

		if (codeUnit >= HIGH_SURROGATE_MIN && codeUnit <= HIGH_SURROGATE_MAX)
		{
			const nextCodeUnit = value.charCodeAt(index + 1);
			if (!Number.isInteger(nextCodeUnit) || nextCodeUnit < LOW_SURROGATE_MIN || nextCodeUnit > LOW_SURROGATE_MAX)
			{
				throw new TypeError("RFC 8785 JSON strings must not contain lone Unicode surrogates");
			}

			index += 1;
		}
		else if (codeUnit >= LOW_SURROGATE_MIN && codeUnit <= LOW_SURROGATE_MAX)
		{
			throw new TypeError("RFC 8785 JSON strings must not contain lone Unicode surrogates");
		}
	}
}

/**
 * Serializes a string after enforcing the Unicode requirements from RFC 8785 section 3.2.2.2.
 * @param value - String or object-property name to serialize.
 * @returns ECMAScript JSON string representation required by JCS.
 */
function _serializeString(value: string): string
{
	_assertValidUnicode(value);
	return JSON.stringify(value);
}

/**
 * Serializes an array while rejecting sparse or augmented JavaScript arrays.
 * @param value - Array to serialize.
 * @param activeContainers - Containers on the current recursion path.
 * @returns Canonical JSON array representation.
 */
function _serializeArray(value: readonly JsonValue[], activeContainers: WeakSet<object>): string
{
	// 1. Recursion guard — JSON cannot represent a container that contains itself.
	if (activeContainers.has(value))
	{
		throw new TypeError("RFC 8785 JSON values must not contain reference cycles");
	}

	// 2. Data-model guard — only a dense sequence of enumerable data entries is canonicalizable.
	const ownKeys = Reflect.ownKeys(value);
	const expectedKeyCount = value.length + 1;
	if (ownKeys.length !== expectedKeyCount)
	{
		throw new TypeError("RFC 8785 arrays must be dense and contain only indexed JSON values");
	}

	for (let index = 0; index < value.length; index += 1)
	{
		const descriptor = Object.getOwnPropertyDescriptor(value, index);
		if (!descriptor?.enumerable || !("value" in descriptor))
		{
			throw new TypeError("RFC 8785 arrays must contain dense enumerable data entries");
		}
	}

	// 3. Serialization — mark only the active path so repeated non-cyclic references remain valid JSON.
	activeContainers.add(value);
	const serializedItems = value.map(item => _serializeValue(item, activeContainers));
	activeContainers.delete(value);
	return `[${serializedItems.join(",")}]`;
}

/**
 * Serializes a plain JSON object with UTF-16 code-unit-sorted property names.
 * @param value - Object to serialize.
 * @param activeContainers - Containers on the current recursion path.
 * @returns Canonical JSON object representation.
 */
function _serializeObject(value: { readonly [key: string]: JsonValue }, activeContainers: WeakSet<object>): string
{
	// 1. Recursion guard — JSON cannot represent a container that contains itself.
	if (activeContainers.has(value))
	{
		throw new TypeError("RFC 8785 JSON values must not contain reference cycles");
	}

	// 2. Data-model guard — class instances, symbols, and accessors are not parsed JSON values.
	const prototype = Object.getPrototypeOf(value) as object | null;
	if (prototype !== Object.prototype && prototype !== null)
	{
		throw new TypeError("RFC 8785 objects must be plain JSON objects");
	}

	const ownKeys = Reflect.ownKeys(value);
	if (ownKeys.some(key => typeof key !== "string"))
	{
		throw new TypeError("RFC 8785 objects must not contain symbol properties");
	}

	// 3. Serialization — order names by UTF-16 code units while tracking only the active recursion path.
	activeContainers.add(value);
	const keys = (ownKeys as string[]).sort();
	const members = keys.map(function _serializeMember(key): string
	{
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !("value" in descriptor))
		{
			throw new TypeError("RFC 8785 objects must contain enumerable data properties only");
		}

		return `${_serializeString(key)}:${_serializeValue(descriptor.value as JsonValue, activeContainers)}`;
	});
	activeContainers.delete(value);

	return `{${members.join(",")}}`;
}

/**
 * Serializes one validated JSON value according to RFC 8785.
 * @param value - JSON value to serialize.
 * @param activeContainers - Containers on the current recursion path.
 * @returns Canonical JSON representation.
 */
function _serializeValue(value: JsonValue, activeContainers: WeakSet<object>): string
{
	if (value === null)
	{
		return "null";
	}

	switch (typeof value)
	{
		case "string":
			return _serializeString(value);
		case "boolean":
			return value ? "true" : "false";
		case "number":
			if (!Number.isFinite(value))
			{
				throw new TypeError("RFC 8785 JSON numbers must be finite IEEE 754 values");
			}

			return JSON.stringify(value);
		case "object":
			return Array.isArray(value)
				? _serializeArray(value, activeContainers)
				: _serializeObject(value as { readonly [key: string]: JsonValue }, activeContainers);
		default:
			throw new TypeError("RFC 8785 canonicalization accepts JSON values only");
	}
}

/**
 * Canonicalizes a JSON value with the JSON Canonicalization Scheme from RFC 8785.
 * Object properties are ordered by UTF-16 code units and numbers use ECMAScript's
 * shortest round-trip representation. Invalid Unicode and non-JSON values fail closed.
 * @param value - JSON value to canonicalize.
 * @returns Deterministic UTF-8-ready canonical JSON text.
 * @see https://www.rfc-editor.org/rfc/rfc8785
 */
export function ___CanonicalizeJson(value: JsonValue): string
{
	return _serializeValue(value, new WeakSet<object>());
}

/**
 * Deep-copies a JSON value through its RFC 8785 canonical form, so the copy is
 * detached from caller-owned references and key order is deterministic.
 * @param value - JSON value to copy.
 * @returns An equivalent value that shares no references with the input.
 */
export function ___CloneCanonicalJson(value: JsonValue): JsonValue
{
	return JSON.parse(___CanonicalizeJson(value)) as JsonValue;
}
