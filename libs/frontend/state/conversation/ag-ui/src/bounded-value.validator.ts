/** Whether a value is a non-empty string of at most 256 characters. */
export function _BoundedIdentifier(value: unknown): value is string
{
	return typeof value === "string" && value.length > 0 && value.length <= 256;
}

/** Whether a value is an ISO-8601 UTC timestamp that round-trips exactly through Date.toISOString(). */
export function _CanonicalInstant(value: unknown): value is string
{
	if (typeof value !== "string") return false;
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}
