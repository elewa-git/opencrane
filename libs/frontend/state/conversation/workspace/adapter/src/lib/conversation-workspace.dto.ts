export { _ParseConversationDetail as _ConversationDetail, _ParseConversationRun as _ConversationRun, _ParseConversationSummary as _ConversationSummary, _ParseConversationWorkspaceDirectory as _ConversationWorkspaceDirectory } from "@opencrane/state/conversation/workspace";

import { MessageRoles } from "@opencrane/models/conversations";
import { ___ParsePersonaFirstChatSnapshot, PersonaFirstChatTranscriptRoles, UserOnboardingRouteStates, type PersonaFirstChatTranscriptEntry } from "@opencrane/models/user-onboarding";
import { ConversationOnboardingHistoryStatuses, type ConversationOnboardingHistoryEntry, type ConversationOnboardingHistoryProjection } from "@opencrane/state/conversation/workspace";

/** Validate onboarding authority state, then map it to a separate read-only projection. */
export function _ConversationOnboardingHistory(value: unknown): ConversationOnboardingHistoryProjection
{
	const snapshot = ___ParsePersonaFirstChatSnapshot(value);
	if (snapshot.state !== UserOnboardingRouteStates.Completed) return { status: ConversationOnboardingHistoryStatuses.NotCompleted, history: null };
	if (snapshot.conversationId === null) return { status: ConversationOnboardingHistoryStatuses.NotRecorded, history: null };
	if (snapshot.persona === null || snapshot.startedAt === null || snapshot.completedAt === null) throw new Error("Completed onboarding history is missing required evidence.");
	return { status: ConversationOnboardingHistoryStatuses.Ready, history: { id: snapshot.conversationId, personaDisplayName: snapshot.persona.displayName, startedAt: snapshot.startedAt, completedAt: snapshot.completedAt, transcript: snapshot.transcript.map(_ConversationOnboardingHistoryEntry) } };
}

/** Preserve onboarding roles as a read-only presentation mapping. */
function _ConversationOnboardingHistoryEntry(entry: PersonaFirstChatTranscriptEntry): ConversationOnboardingHistoryEntry
{
	const role = entry.role === PersonaFirstChatTranscriptRoles.Assistant ? MessageRoles.Assistant : MessageRoles.User;
	return { ordinal: entry.ordinal, role, text: entry.text };
}
