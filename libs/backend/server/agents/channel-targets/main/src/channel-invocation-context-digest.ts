import { createHash } from "node:crypto";

/** Digest one presented opaque invocation context for storage and authority lookup. */
export function __DigestChannelInvocationContext(invocationContext: string): string
{
	return `sha256:${createHash("sha256").update(invocationContext, "utf8").digest("hex")}`;
}
