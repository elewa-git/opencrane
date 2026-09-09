import type { ConversationComputerCredentialIssueCommand } from "../../../conversation-computer-turn.types";

/** Shortens the request to its remaining authority before each provider issue. It never raises a budget. */
export function _BoundCredentialIssue(input: ConversationComputerCredentialIssueCommand): ConversationComputerCredentialIssueCommand
{
	const now = Date.now();
	const remaining = Math.floor((Date.parse(input.notAfter) - now) / 1_000);
	if (!Number.isSafeInteger(input.expirySeconds) || input.expirySeconds < 1 || !Number.isFinite(remaining) || remaining < 1)
		throw new Error("Conversation computer credential requires unexpired authority");
	const expirySeconds = Math.min(input.expirySeconds, remaining);
	return { ...input, expirySeconds, notAfter: new Date(now + expirySeconds * 1_000).toISOString() };
}

/** Refuses a provider key that has expired or extends beyond the authority used to request it. */
export function _AssertCredentialIssueExpiry(expiresAt: string, input: ConversationComputerCredentialIssueCommand): void
{
	if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now() || Date.parse(expiresAt) > Date.parse(input.notAfter))
		throw new Error("Conversation computer provider key exceeds its current authority expiry");
}
