import { createHash } from "node:crypto";

/**
 * Hash one opaque invocation context into the `sha256:<hex>` form used for storage and lookup.
 *
 * The opaque value itself is never written to the database - only this digest - so a stolen
 * database row cannot be replayed as a valid pass. Both sides must use this same function: the
 * resolver digests the value it mints before inserting the row, and the runtime digests the value
 * it was presented before looking that row up. The `sha256:` prefix is part of the stored value.
 *
 * Called by: __ResolveChannelTarget in this package, and the replay route in
 * libs/backend/server/conversations/main/src/conversation-replay.router.ts.
 *
 * @param invocationContext - The opaque value, read as UTF-8.
 * @returns `sha256:` followed by the 64-character lower-case hex digest.
 */
export function __DigestChannelInvocationContext(invocationContext: string): string
{
	return `sha256:${createHash("sha256").update(invocationContext, "utf8").digest("hex")}`;
}
