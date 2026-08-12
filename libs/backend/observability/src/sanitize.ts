/** Marker written instead of a value that may carry credentials or tool arguments. */
const _REDACTED = "[Redacted]";

/** Marker written when a log value exceeds the bounded recursive projection. */
const _TRUNCATED = "[Truncated]";

/** Maximum object depth inspected before the whole remaining value is removed. */
const _MAX_DEPTH = 12;

/** Case-insensitive field names whose values must never leave the process in logs. */
const _SENSITIVE_FIELD_NAMES = new Set([
	"authorization",
	"cookie",
	"set-cookie",
	"last-event-id",
	"cursor",
	"password",
	"token",
	"accesstoken",
	"refreshtoken",
	"apikey",
	"masterkey",
	"client_secret",
	"clientsecret",
	"database_url",
	"databaseurl",
	"reviewedtoolarguments",
	"finalarguments",
	"arguments",
	"result",
]);

/** Return whether an object can be projected without changing framework-owned runtime behavior. */
function _isPlainRecord(value: object): boolean
{
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

/** Recursively project one JSON-like value while dropping sensitive fields at any depth. */
function _sanitizeLogValue(value: unknown, depth: number, seen: WeakSet<object>): unknown
{
	// 1. Preserve primitives and framework-owned special objects for pino's configured serializers.
	if (value === null || typeof value !== "object") return value;
	if (value instanceof Error || value instanceof Date || Buffer.isBuffer(value) || (!_isPlainRecord(value) && !Array.isArray(value))) return value;

	// 2. Bound recursion and cycles before traversing attacker-controlled or accidental deep values.
	if (depth >= _MAX_DEPTH) return _TRUNCATED;
	if (seen.has(value)) return "[Circular]";
	seen.add(value);
	if (Array.isArray(value)) return value.map(item => _sanitizeLogValue(item, depth + 1, seen));

	// 3. Redact exact field names case-insensitively while preserving diagnostic siblings.
	const sanitized: Record<string, unknown> = {};
	for (const [name, nestedValue] of Object.entries(value))
	{
		sanitized[name] = _SENSITIVE_FIELD_NAMES.has(name.toLowerCase())
			? _REDACTED
			: _sanitizeLogValue(nestedValue, depth + 1, seen);
	}
	return sanitized;
}

/**
 * Project pino log fields without credentials, replay cursors, or executable tool arguments.
 *
 * Non-sensitive siblings such as operation, outcome, identifiers, and argument digests remain
 * available for diagnosis. Unexpected getters fail closed by replacing the complete field set.
 * @param fields - Root pino merge object or child bindings.
 * @returns A bounded JSON-like projection safe for serialization.
 */
export function _SanitizeLogFields(fields: Record<string, unknown>): Record<string, unknown>
{
	try
	{
		return _sanitizeLogValue(fields, 0, new WeakSet<object>()) as Record<string, unknown>;
	}
	catch
	{
		return { logFields: _REDACTED };
	}
}
