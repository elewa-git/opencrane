import { createHash } from "node:crypto";

/**
 * Derives the stable UUID-shaped identity used by conversation-computer history events.
 *
 * The colon separator and SHA-256 input encoding are part of the existing persisted identity
 * contract. This helper intentionally does not replace the conversation-session or turn-authority
 * identifiers, which use different encodings.
 */
export function _ConversationComputerEventId(domain: string, value: string): string
{
	const hex = createHash("sha256").update(`${domain}:${value}`).digest("hex").slice(0, 32).split("");
	hex[12] = "4";
	hex[16] = "8";
	return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}
