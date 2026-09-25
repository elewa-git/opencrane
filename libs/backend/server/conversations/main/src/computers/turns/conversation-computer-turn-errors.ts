/**
 * Reports that canonical lease, Pod or history evidence has ended this turn's authority.
 *
 * A workflow caller returns `authority_ended` and must not retry or persist an unavailable result.
 * Infrastructure failures keep their original error type so ordinary recovery can retry them.
 *
 * Called by: the active candidate resolver and ConversationComputerTurnAuthority.advance.
 */
export class _ConversationComputerTurnAuthorityEndedError extends Error {}
