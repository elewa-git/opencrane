import { PersonaArchetypeTones } from "@opencrane/elements/ui";
import { PersonaFirstChatArchetypes, PersonaFirstChatTranscriptRoles, type PersonaFirstChatContentRevision, type PersonaFirstChatCurrentQuestion, type PersonaFirstChatPersona, type PersonaFirstChatSnapshot, type PersonaFirstChatTranscriptEntry } from "@opencrane/state/onboarding/projection";

import { type PersonaFirstChatIdentity, PersonaFirstChatMessageRoles, type PersonaFirstChatProvenance, type PersonaFirstChatQuestion, type PersonaFirstChatQuestionOrdinal, type PersonaFirstChatTranscriptMessage, type PersonaFirstChatView } from "./persona-first-chat.types.js";

/**
 * Turns a server snapshot into the view model the chat component renders.
 *
 * Pure: given the same snapshot it always returns the same view. It renames fields and maps enums but
 * invents nothing — the transcript keeps the server's order, and revision labels are passed through
 * unchanged rather than prettified, so what the user checks is what the server said.
 *
 * The snapshot types come from `@opencrane/state/onboarding/projection`, the read-only projection barrel
 * over the onboarding model package, so this mapper pulls in no gateway or store code.
 *
 * Called by: {@link PersonaFirstChatPageComponent}'s private `_view`, which calls it for any snapshot the
 * resource has loaded and simply renders its preparing state when the result is null.
 *
 * @param snapshot - The server snapshot to render.
 * @returns The view model, or null when the snapshot has no persona or no content revision yet — the
 * shape of a chat that has not started, which the caller shows as its preparing state rather than an
 * error. Covered by the null cases in __tests__/persona-first-chat.view.spec.ts.
 * @throws Error when the snapshot names a question number outside 1-3, so a fourth question is refused
 * instead of drawn. See {@link _QuestionOrdinal}.
 * @see PersonaFirstChatView
 */
export function _PersonaFirstChatView(snapshot: PersonaFirstChatSnapshot): PersonaFirstChatView | null
{
	if (snapshot.persona === null || snapshot.contentRevision === null) return null;
	return {
		identity: _Identity(snapshot.persona),
		provenance: _Provenance(snapshot.persona, snapshot.contentRevision),
		transcript: _Transcript(snapshot),
		currentQuestion: snapshot.currentQuestion === null ? null : _Question(snapshot.currentQuestion)
	};
}

/** Build the agent's display identity — name, initials and tone — from the approved persona. */
function _Identity(persona: PersonaFirstChatPersona): PersonaFirstChatIdentity
{
	return { name: persona.displayName, initials: _Initials(persona.displayName), archetype: _ArchetypeTone(persona.archetype) };
}

/** Pass the persona and question-set revision labels through unchanged; never make up a nicer label. */
function _Provenance(persona: PersonaFirstChatPersona, contentRevision: PersonaFirstChatContentRevision): PersonaFirstChatProvenance
{
	return { personaRevision: persona.revisionId, scriptLabel: contentRevision.sourceLabel, scriptRevision: contentRevision.id };
}

/** Keep the server's order; change only the role values and field names. */
function _Transcript(snapshot: PersonaFirstChatSnapshot): readonly PersonaFirstChatTranscriptMessage[]
{
	const conversationId = snapshot.conversationId ?? "pending";
	return snapshot.transcript.map(function _Message(entry)
	{
		return _TranscriptMessage(conversationId, entry);
	});
}

/** Map one server role onto the local role enum; no other value is possible. */
function _TranscriptMessage(conversationId: string, entry: PersonaFirstChatTranscriptEntry): PersonaFirstChatTranscriptMessage
{
	const role = entry.role === PersonaFirstChatTranscriptRoles.Assistant ? PersonaFirstChatMessageRoles.Agent : PersonaFirstChatMessageRoles.Owner;
	return { id: `${conversationId}-${entry.ordinal}`, role, body: entry.text };
}

/** Map the current question onto the component's 1-2-3 ordinal type. */
function _Question(question: PersonaFirstChatCurrentQuestion): PersonaFirstChatQuestion
{
	return { id: `question-${question.ordinal}`, ordinal: _QuestionOrdinal(question.ordinal), prompt: question.text };
}

/** Throw on a question number outside 1-3, rather than displaying a fourth question. */
function _QuestionOrdinal(ordinal: number): PersonaFirstChatQuestionOrdinal
{
	switch (ordinal)
	{
		case 1: return 1;
		case 2: return 2;
		case 3: return 3;
		default: throw new Error("The onboarding authority returned an invalid first-chat question ordinal.");
	}
}

/** Map the archetype onto its shared PersonaArchetypeTones value. */
function _ArchetypeTone(archetype: PersonaFirstChatArchetypes): PersonaArchetypeTones
{
	switch (archetype)
	{
		case PersonaFirstChatArchetypes.Commander: return PersonaArchetypeTones.Commander;
		case PersonaFirstChatArchetypes.Catalyst: return PersonaArchetypeTones.Catalyst;
		case PersonaFirstChatArchetypes.Anchor: return PersonaArchetypeTones.Anchor;
		case PersonaFirstChatArchetypes.Analyst: return PersonaArchetypeTones.Analyst;
	}
}

/** Build the avatar initials from the persona's display name. */
function _Initials(name: string): string
{
	return name.split(/\s+/u).filter(function _NonBlank(part) { return part.length > 0; }).slice(0, 2).map(function _First(part) { return part.charAt(0).toUpperCase(); }).join("") || "AI";
}
