import type { JsonValue } from "./json-canonicalization.types";

/** Maximum Unicode high-surrogate code unit. */
const HIGH_SURROGATE_MAX = 0xdbff;

/** Minimum Unicode high-surrogate code unit. */
const HIGH_SURROGATE_MIN = 0xd800;

/** Maximum Unicode low-surrogate code unit. */
const LOW_SURROGATE_MAX = 0xdfff;

/** Minimum Unicode low-surrogate code unit. */
const LOW_SURROGATE_MIN = 0xdc00;

/**
 * Throws when a string contains an unpaired Unicode surrogate, which RFC 8785 requires be rejected.
 *
 * An unpaired surrogate has no valid UTF-8 encoding, so it would make the digest depend on how the
 * runtime chose to substitute it.
 * @param value - String being prepared for canonical serialization.
 * @throws TypeError on an unpaired surrogate.
 * @see https://www.rfc-editor.org/rfc/rfc8785
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

	// 2. Reject a sparse array or one with extra properties — neither survives a JSON round trip.
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

	// 3. Track only the containers on the current path, so the same object appearing twice side by side is still valid — only a true cycle fails.
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

	// 2. Reject class instances, symbol keys, and getters — none of them can come from parsed JSON.
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
 * Canonicalizes a JSON value using the JSON Canonicalization Scheme from RFC 8785.
 *
 * Two values that are equal as JSON produce byte-identical text: property names are sorted by
 * UTF-16 code unit, and numbers use ECMAScript's shortest round-trip form. That is what makes a
 * digest over the result stable across machines and runtimes — see {@link ___DigestCanonicalJson}.
 *
 * It fails closed rather than guessing. Anything that could not have come from parsed JSON — a
 * class instance, a symbol key, a getter, a sparse array, an unpaired surrogate, a non-finite
 * number, a cycle — throws instead of being coerced.
 *
 * Called by: {@link ___DigestCanonicalJson}, {@link ___CloneCanonicalJson},
 * `libs/backend/artifacts/authorization/main/src/artifact-lease.ts`,
 * `libs/backend/agents/memory/main/src/prisma-memory-catalog-repository.ts`.
 * @param value - JSON value to canonicalize.
 * @returns Canonical JSON text, ready to encode as UTF-8.
 * @throws TypeError for any value that could not have come from parsed JSON, including cycles and unpaired surrogates.
 * @see https://www.rfc-editor.org/rfc/rfc8785
 */
export function ___CanonicalizeJson(value: JsonValue): string
{
	return _serializeValue(value, new WeakSet<object>());
}

/**
 * Deep-copies a JSON value by canonicalizing it and parsing the result back.
 *
 * Use this when a value crosses an ownership boundary: the copy shares no references with the
 * input, so a later mutation by the caller cannot reach it, and its key order is deterministic so
 * it digests identically wherever it is stored.
 *
 * Because it round-trips through {@link ___CanonicalizeJson}, it rejects the same inputs — this is
 * not a permissive `structuredClone`.
 *
 * @param value - JSON value to copy.
 * @returns An equivalent value sharing no references with the input.
 * @throws TypeError for any input {@link ___CanonicalizeJson} rejects.
 * @see https://www.rfc-editor.org/rfc/rfc8785
 */
export function ___CloneCanonicalJson(value: JsonValue): JsonValue
{
	return JSON.parse(___CanonicalizeJson(value)) as JsonValue;
}
