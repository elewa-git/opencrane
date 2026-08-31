/** Marker written instead of a value that may carry credentials or tool arguments. */
const _REDACTED = "[Redacted]";

/** Marker written in place of a value nested deeper than `_MAX_DEPTH`. */
const _TRUNCATED = "[Truncated]";

/** Maximum object depth inspected before the whole remaining value is removed. */
const _MAX_DEPTH = 12;

/** Lists case-insensitive field names whose values must never leave the process in logs. */
const _SENSITIVE_FIELD_NAMES = new Set([
	"authorization",
	"cookie",
	"set-cookie",
	"last-event-id",
	"x-opencrane-scan-fence",
	"x-opencrane-artifact-lease",
	"cursor",
	"claimfence",
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
	"providerkey",
	"materialverifier",
	"reviewedtoolarguments",
	"finalarguments",
	"arguments",
	"result",
]);

/** Return whether an object is a plain object, so copying it field by field cannot break something a framework owns. */
function _isPlainRecord(value: object): boolean
{
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

/** Copy a value, dropping sensitive fields at every depth and stopping at `_MAX_DEPTH` or a cycle. */
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
 * Copy pino's log fields with credentials, replay cursors, and tool arguments removed.
 *
 * Runs as pino's `log` and `bindings` formatter, so every record passes through it. Sensitive
 * field names are replaced with `[Redacted]` at any depth; their harmless siblings — operation
 * name, outcome, identifiers, argument digests — survive, so a record stays useful for diagnosis.
 *
 * Fails closed: if anything throws while walking the value, such as a getter with a side effect,
 * the entire field set is dropped and replaced with a single redacted marker rather than emitting
 * a partly-walked object.
 *
 * Called by: {@link ___CreateLogger} only; it is wired in as a pino formatter and is not meant to
 * be called directly.
 * @param fields - Pino's merge object or child bindings.
 * @returns A depth-limited copy safe to serialize; `{ logFields: "[Redacted]" }` when walking failed.
 * @see {@link REDACT_PATHS}
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
