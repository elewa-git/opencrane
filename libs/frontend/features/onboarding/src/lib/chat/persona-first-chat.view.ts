import { PersonaArchetypeTones } from "@opencrane/elements/ui";
import { PersonaFirstChatArchetypes, type PersonaFirstChatContentRevision, type PersonaFirstChatCurrentQuestion, type PersonaFirstChatPersona, type PersonaFirstChatSnapshot, type PersonaFirstChatTranscriptEntry, PersonaFirstChatTranscriptRoles } from "@opencrane/state/onboarding";

import { type PersonaFirstChatIdentity, PersonaFirstChatMessageRoles, type PersonaFirstChatProvenance, type PersonaFirstChatQuestion, type PersonaFirstChatQuestionOrdinal, type PersonaFirstChatTranscriptMessage, type PersonaFirstChatView } from "./persona-first-chat.types.js";

/** Map one authoritative server projection into the complete presentational contract. */
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

/** Map exact approved persona evidence into presentational identity. */
function _Identity(persona: PersonaFirstChatPersona): PersonaFirstChatIdentity
{
	return { name: persona.displayName, initials: _Initials(persona.displayName), archetype: _ArchetypeTone(persona.archetype) };
}

/** Map exact persona and source coordinates without inventing friendlier revisions. */
function _Provenance(persona: PersonaFirstChatPersona, contentRevision: PersonaFirstChatContentRevision): PersonaFirstChatProvenance
{
	return { personaRevision: persona.revisionId, scriptLabel: contentRevision.sourceLabel, scriptRevision: contentRevision.id };
}

/** Preserve canonical order while adapting only role and field names for presentation. */
function _Transcript(snapshot: PersonaFirstChatSnapshot): readonly PersonaFirstChatTranscriptMessage[]
{
	const conversationId = snapshot.conversationId ?? "pending";
	return snapshot.transcript.map(function _Message(entry)
	{
		return _TranscriptMessage(conversationId, entry);
	});
}

/** Adapt one server transcript role without weakening the finite vocabulary. */
function _TranscriptMessage(conversationId: string, entry: PersonaFirstChatTranscriptEntry): PersonaFirstChatTranscriptMessage
{
	const role = entry.role === PersonaFirstChatTranscriptRoles.Assistant ? PersonaFirstChatMessageRoles.Agent : PersonaFirstChatMessageRoles.Owner;
	return { id: `${conversationId}-${entry.ordinal}`, role, body: entry.text };
}

/** Map the exact current question into the component's bounded one-of-three contract. */
function _Question(question: PersonaFirstChatCurrentQuestion): PersonaFirstChatQuestion
{
	return { id: `question-${question.ordinal}`, ordinal: _QuestionOrdinal(question.ordinal), prompt: question.text };
}

/** Reject any ordinal outside the reviewed three-question bootstrap contract. */
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

/** Map the reviewed bootstrap archetype onto the shared semantic visual treatment. */
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

/** Derive bounded display initials from the reviewed persona name. */
function _Initials(name: string): string
{
	return name.split(/\s+/u).filter(function _NonBlank(part) { return part.length > 0; }).slice(0, 2).map(function _First(part) { return part.charAt(0).toUpperCase(); }).join("") || "AI";
}
