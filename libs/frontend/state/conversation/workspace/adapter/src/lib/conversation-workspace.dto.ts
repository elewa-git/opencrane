import { MessageRoles } from "@opencrane/models/conversations";
import { ___ParsePersonaFirstChatSnapshot, PersonaFirstChatTranscriptRoles, UserOnboardingRouteStates, type PersonaFirstChatTranscriptEntry } from "@opencrane/models/user-onboarding";
import { ConversationOnboardingHistoryStatuses, type ConversationOnboardingHistoryEntry, type ConversationOnboardingHistoryProjection } from "@opencrane/state/conversation/workspace";

/**
 * Turns signed-in HTTP responses into the shapes the workspace state package declares.
 *
 * This file is the boundary itself. Below it, field names and JSON come from the generated OpenAPI
 * client and can change whenever the API does; above it, `@opencrane/state/conversation/workspace`
 * owns every type and enum, and nothing here may invent a field that package did not declare.
 *
 * The conversation validators belong to that state package, not to this adapter — its README explains
 * that keeping runtime checks beside the models stops HTTP code from rebuilding the domain shape. They
 * are re-exported below under shorter names so the gateway reads as one list of mappers.
 *
 * @see OpenCraneConversationWorkspaceGateway — the only caller of anything in this file.
 */
export { _ParseConversationDetail as _ConversationDetail, _ParseConversationRun as _ConversationRun, _ParseConversationSummary as _ConversationSummary, _ParseConversationWorkspaceDirectory as _ConversationWorkspaceDirectory } from "@opencrane/state/conversation/workspace";

/**
 * Checks the onboarding response, then reduces it to what the workspace is allowed to show as history.
 *
 * The body comes from the same `GET /me/onboarding/chat` projection the onboarding pages read, so it is
 * validated by the onboarding model package's own parser rather than by a second schema kept here — two
 * schemas for one endpoint would drift, and this adapter would start accepting shapes onboarding rejects.
 *
 * What comes back is a decision the workspace can act on, not a raw snapshot. Onboarding that is not
 * finished, and onboarding finished with nothing recorded, are ordinary answers here rather than errors:
 * the conversation list has copy for each, and normal chats must keep loading either way.
 *
 * Called by: {@link OpenCraneConversationWorkspaceGateway.onboardingHistory}, which converts any throw
 * into a recoverable gateway error.
 *
 * @param value - The decoded JSON body of `GET /me/onboarding/chat`. It is passed whole because that
 * endpoint returns the snapshot itself, unlike the conversation reads which arrive inside a wrapper.
 * @returns `Ready` with the transcript when the user finished the guided chat; `NotCompleted` when they
 * are still in onboarding, so the workspace must not draw a finished transcript; `NotRecorded` when the
 * account was completed without a saved exchange, as for a migrated user, which the list explains in
 * words instead of showing an empty transcript. `Unavailable` is never returned from here — the store
 * uses it when this throws.
 * @throws Error when the body is not a valid first-chat projection, or when it claims a completed
 * bootstrap exchange without the persona and timestamps that such an exchange always carries.
 * @see ___ParsePersonaFirstChatSnapshot
 * @see ConversationOnboardingHistoryStatuses
 */
export function _ConversationOnboardingHistory(value: unknown): ConversationOnboardingHistoryProjection
{
	// 1. Validate with the onboarding model's own parser, so this adapter cannot accept a snapshot the onboarding pages would reject.
	const snapshot = ___ParsePersonaFirstChatSnapshot(value);
	// 2. Onboarding still in progress is a normal answer: the list says "Onboarding is not complete yet." rather than the read failing.
	if (snapshot.state !== UserOnboardingRouteStates.Completed) return { status: ConversationOnboardingHistoryStatuses.NotCompleted, history: null };
	// 3. Completed with no conversation id is the existing-user migration the validator allows (_MigratedCompletionEvidence). Report it, rather than treating the missing transcript as a fault.
	if (snapshot.conversationId === null) return { status: ConversationOnboardingHistoryStatuses.NotRecorded, history: null };
	// 4. Past step 3 the validator's completed-bootstrap rules already guarantee these three fields, so this satisfies the null checks and fails loudly if the server ever contradicts itself.
	if (snapshot.persona === null || snapshot.startedAt === null || snapshot.completedAt === null) throw new Error("Completed onboarding history is missing required evidence.");
	// 5. Copy across only the fields the history panel draws, keeping the server's transcript order.
	return { status: ConversationOnboardingHistoryStatuses.Ready, history: { id: snapshot.conversationId, personaDisplayName: snapshot.persona.displayName, startedAt: snapshot.startedAt, completedAt: snapshot.completedAt, transcript: snapshot.transcript.map(_ConversationOnboardingHistoryEntry) } };
}

/**
 * Converts one onboarding transcript line into the roles the workspace message components understand.
 *
 * Onboarding has its own two-value role list ({@link PersonaFirstChatTranscriptRoles}: `Assistant` and
 * `User`), while the workspace draws messages from {@link MessageRoles}. Mapping here keeps the
 * onboarding enum out of workspace state, and because the source enum has only those two members,
 * anything that is not `Assistant` is the user's own line.
 *
 * The result is not a conversation message: it carries an ordinal, a role and text, and no message id,
 * position, run or lifecycle, so nothing downstream can reply to it or retry it.
 *
 * @param entry - One validated transcript entry, in the order the server sent it.
 * @returns The ordinal, role and text the history panel renders.
 */
function _ConversationOnboardingHistoryEntry(entry: PersonaFirstChatTranscriptEntry): ConversationOnboardingHistoryEntry
{
	const role = entry.role === PersonaFirstChatTranscriptRoles.Assistant ? MessageRoles.Assistant : MessageRoles.User;
	return { ordinal: entry.ordinal, role, text: entry.text };
}
