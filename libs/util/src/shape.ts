import type { ___ParsedShape, ___Shape, ___ShapeFieldParser } from "./shape.types.js";

/** Return whether the value is a bounded, non-empty identifier free of ASCII control characters. */
export function ___IsBoundedIdentifier(value: unknown): value is string
{
	return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Return whether the value is a positive JavaScript-safe integer. */
export function ___IsPositiveInteger(value: unknown): value is number
{
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Return whether the value is a canonical UTC millisecond instant that round-trips through toISOString. */
export function ___IsMillisecondInstant(value: unknown): value is string
{
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
	const epochMilliseconds = Date.parse(value);
	return Number.isSafeInteger(epochMilliseconds) && new Date(epochMilliseconds).toISOString() === value;
}

/** Build a field parser from a type predicate and the requirement named in its failure diagnostic. */
export function ___RequireField<T>(isValid: (value: unknown) => value is T, requirement: string): ___ShapeFieldParser<T>
{
	return function _parseField(value: unknown, path: string): T
	{
		if (!isValid(value)) throw new Error(`${path} must be ${requirement}`);
		return value;
	};
}

/** Ready-made field parsers for the identifier, count, and instant fields shared by internal API adapters. */
export const ___ShapeFields = {
	/** Bounded non-empty identifier without control characters. */
	identifier: ___RequireField(___IsBoundedIdentifier, "a bounded identifier"),
	/** Positive JavaScript-safe integer. */
	positiveInteger: ___RequireField(___IsPositiveInteger, "a positive integer"),
	/** Canonical UTC millisecond instant. */
	instant: ___RequireField(___IsMillisecondInstant, "a UTC millisecond instant"),
} as const;

/**
 * Parse an untrusted value into exactly the declared shape, naming the offending field on failure.
 *
 * Each declared field is validated and copied through its parser, so the returned object carries
 * only declared fields and a failure diagnostic names the exact `source.field` path that broke the
 * contract instead of one opaque malformed-response error.
 *
 * @param value - Untrusted candidate from a transport or configuration boundary.
 * @param sourceName - Stable source label prefixed to every field path in diagnostics.
 * @param shape - Declarative field-parser map defining the accepted object.
 * @returns The validated object containing exactly the declared fields.
 */
export function ___ParseShape<S extends ___Shape>(value: unknown, sourceName: string, shape: S): ___ParsedShape<S>
{
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${sourceName} must be a JSON object`);
	const record = value as Record<string, unknown>;
	const parsed: Record<string, unknown> = {};
	for (const key of Object.keys(shape)) parsed[key] = shape[key]!(record[key], `${sourceName}.${key}`);
	return parsed as ___ParsedShape<S>;
}
