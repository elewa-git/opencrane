import type { AgentThreadTarget, AgentThreadTargetDecision } from "./agent-thread.types.js";

/**
 * Longest `agentServiceId` this check will accept.
 *
 * It repeats the limit the HTTP boundary already applies — `agentTarget.agentServiceId` is declared
 * `max(128)` in the self-conversations router's Zod schema and `maxLength: 128` in the published
 * OpenAPI document — so a caller that does not come through that route is held to the same bound.
 */
const _IDENTIFIER_LIMIT = 128;

/**
 * Checks that an `@agent` target is well-formed before anything touches the database.
 *
 * A group participant names the Agent they want, and that name goes on to be looked up as a primary
 * key. This does the part that needs no I/O: the id must be non-empty, no longer than
 * {@link _IDENTIFIER_LIMIT}, and free of surrounding whitespace. Padding is refused rather than
 * trimmed away, so the check never quietly changes the id the caller sent; the self-conversations
 * router trims first, so a padded id arriving from that route has already been normalised.
 *
 * Passing here proves nothing about the Agent itself. The owning checks still happen inside the
 * admission transaction, where `prepareAgentThread` requires the service to exist in the caller's
 * silo with kind `Personal`, state `Active` and a published revision, and requires the caller to hold
 * an approved persona.
 *
 * Called by: `src/__tests__/agent-thread.test.ts` only. No production path calls it yet — the group
 * message route validates the same field with Zod, and
 * `PrismaConversationMutationRepository.prepareAgentThread` performs the database checks. See the ASK
 * in the review notes for whether the admission path should call this instead.
 *
 * @param target - The structured target carried on the submitted group message.
 * @returns `{ allowed: true }` when the shape is acceptable and the caller may open the admission
 * transaction; `{ allowed: false }` when it is not, with no reason attached, so the caller must map it
 * to one refusal rather than explaining which rule failed.
 * @see AgentThreadTargetDecision
 */
export function __DecideAgentThreadTarget(target: AgentThreadTarget): AgentThreadTargetDecision
{
	const value = target.agentServiceId;
	return value === value.trim() && value.length > 0 && value.length <= _IDENTIFIER_LIMIT ? { allowed: true } : { allowed: false };
}
