import { ConversationAuthorKinds, type MessageEntry } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";

/**
 * Checks a saved history winner against the currently authorized message retry.
 *
 * The history reader has already validated the saved entry. Its display name and authentication
 * time describe the original write, so a later sign-in or profile edit must not change them.
 * Every other field still has to match, including the issuer, principal, participant, activation,
 * addressed agent and complete encrypted text and artifact blocks. This check never replaces
 * the caller's current membership and permission checks in the admission transaction.
 */
export function _MatchesConversationMessageRetry(saved: MessageEntry, expected: MessageEntry): boolean
{
	if (saved.author.kind !== ConversationAuthorKinds.Human || expected.author.kind !== ConversationAuthorKinds.Human)
		return false;
	const originalAuthor = { ...expected.author, name: saved.author.name, authenticatedAt: saved.author.authenticatedAt };
	const recovered = { ...expected, author: originalAuthor };
	return ___DigestCanonicalJson(saved as unknown as Parameters<typeof ___DigestCanonicalJson>[0])
		=== ___DigestCanonicalJson(recovered as unknown as Parameters<typeof ___DigestCanonicalJson>[0]);
}
