import { ChoiceCardOption, PersonaArchetypeScore, PersonaArchetypeTones } from "@opencrane/elements/ui";
import { PersonaColours, PersonaModifiers, PersonaResolutionKinds, type PersonaOnboardingSnapshot, type PersonaQuestion, type PersonaResolution, type PersonaResult } from "@opencrane/state/onboarding/projection";

import type { PersonaResolutionCopy } from "./persona-onboarding-state.types";

/** Find the next unanswered reviewed question without reinterpreting saved progress. */
export function _FindCurrentQuestion(snapshot: PersonaOnboardingSnapshot): PersonaQuestion | null
{
	return snapshot.questions.find(function _Unanswered(question) { return question.selectedChoiceId === null; }) ?? null;
}

/** Convert reviewed question choices into the shared controlled-card contract. */
export function _QuestionOptions(question: PersonaQuestion | null): readonly ChoiceCardOption[]
{
	if (question === null)
	{
		return [];
	}
	return question.choices.map(function _Choice(choice) { return { id: choice.id, label: choice.label }; });
}

/** Return the reviewed label for an already-recorded immutable choice. */
export function _SelectedChoiceLabel(question: PersonaQuestion): string
{
	return question.choices.find(function _Selected(choice) { return choice.id === question.selectedChoiceId; })?.label ?? "Recorded answer";
}

/** Convert only server-returned tie candidates into the shared controlled-card contract. */
export function _ResolutionOptions(resolution: PersonaResolution | null): readonly ChoiceCardOption[]
{
	if (resolution === null)
	{
		return [];
	}
	return resolution.candidates.map(function _Candidate(candidate)
	{
		return _ResolutionOption(candidate);
	});
}

/**
 * Maps each server resolution kind to copy that describes the decision it controls.
 * The explicit branches keep secondary and modifier ties from inheriting the former leading-style wording.
 *
 * Called by: {@link PersonaResolutionStateComponent.resolutionCopy}.
 * @param kind The tied persona dimension returned by the server.
 * @returns The heading, explanation, and fieldset legend for that decision.
 */
export function _ResolutionCopy(kind: PersonaResolutionKinds): PersonaResolutionCopy
{
	switch (kind)
	{
		case PersonaResolutionKinds.Primary: return {
			title: "Your primary styles are tied",
			description: "These styles scored equally as the strongest influence. Choose how your agent should lead its collaboration.",
			legend: "Choose the primary collaboration style"
		};
		case PersonaResolutionKinds.Secondary: return {
			title: "Your secondary styles are tied",
			description: "These styles scored equally as the supporting influence. Choose how your agent should complement its primary style.",
			legend: "Choose the secondary influence"
		};
		case PersonaResolutionKinds.Modifier: return {
			title: "Your approach preferences are tied",
			description: "Your answers equally support exploring new approaches and relying on proven methods. Choose which approach your agent should prefer.",
			legend: "Choose how your agent should approach new ideas"
		};
	}
}

/** Explain one server-returned tie candidate without changing its persisted value. */
function _ResolutionOption(candidate: PersonaColours | PersonaModifiers): ChoiceCardOption
{
	switch (candidate)
	{
		case PersonaColours.Red:
		case PersonaColours.Yellow:
		case PersonaColours.Green:
		case PersonaColours.Blue: return { id: candidate, label: `${_PersonaArchetypeLabel(candidate)} (${_PersonaValueLabel(candidate)})`, description: _PersonaDescription(candidate) };
		case PersonaModifiers.Explorer: return { id: candidate, label: "Explorer", description: "Prefers novel approaches and creative alternatives." };
		case PersonaModifiers.Guardian: return { id: candidate, label: "Guardian", description: "Prefers proven approaches and bounded risk." };
	}
}

/** Build a truthful visible progress label from server-confirmed counts. */
export function _ProgressLabel(snapshot: PersonaOnboardingSnapshot): string
{
	if (snapshot.questionCount === 0)
	{
		return "No reviewed questions are available";
	}
	const position = Math.min(snapshot.answeredQuestionCount + 1, snapshot.questionCount);
	return `Question ${position} of ${snapshot.questionCount} · ${snapshot.answeredQuestionCount} answers saved`;
}

/** Map one persona colour onto the shared semantic colour treatment. */
export function _PersonaTone(colour: PersonaColours): PersonaArchetypeTones
{
	switch (colour)
	{
		case PersonaColours.Red: return PersonaArchetypeTones.Commander;
		case PersonaColours.Yellow: return PersonaArchetypeTones.Catalyst;
		case PersonaColours.Green: return PersonaArchetypeTones.Anchor;
		case PersonaColours.Blue: return PersonaArchetypeTones.Analyst;
	}
}

/** Explain the selected collaboration preference without presenting it as a diagnosis. */
export function _PersonaDescription(colour: PersonaColours): string
{
	switch (colour)
	{
		case PersonaColours.Red: return "Direct, decisive, and focused on moving work forward.";
		case PersonaColours.Yellow: return "Energetic, collaborative, and comfortable exploring new paths.";
		case PersonaColours.Green: return "Calm, supportive, and attentive to shared understanding.";
		case PersonaColours.Blue: return "Methodical, evidence-led, and explicit about uncertainty.";
	}
}

/** Name the collaboration archetype represented by one server-owned colour. */
function _PersonaArchetypeLabel(colour: PersonaColours): string
{
	switch (colour)
	{
		case PersonaColours.Red: return "Commander";
		case PersonaColours.Yellow: return "Catalyst";
		case PersonaColours.Green: return "Anchor";
		case PersonaColours.Blue: return "Analyst";
	}
}

/** Human-readable name for a server-owned colour, modifier, or tie candidate. */
export function _PersonaValueLabel(value: string): string
{
	if (!value)
	{
		return value;
	}
	return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

/** Derive rounded display percentages from the lossless server-owned score vector. */
export function _PersonaScores(result: PersonaResult): readonly PersonaArchetypeScore[]
{
	return [
		{ id: PersonaColours.Red, label: _PersonaArchetypeLabel(PersonaColours.Red), percentage: _Percentage(result.colourScores.red, result.colourScores.total), tone: PersonaArchetypeTones.Commander },
		{ id: PersonaColours.Yellow, label: _PersonaArchetypeLabel(PersonaColours.Yellow), percentage: _Percentage(result.colourScores.yellow, result.colourScores.total), tone: PersonaArchetypeTones.Catalyst },
		{ id: PersonaColours.Green, label: _PersonaArchetypeLabel(PersonaColours.Green), percentage: _Percentage(result.colourScores.green, result.colourScores.total), tone: PersonaArchetypeTones.Anchor },
		{ id: PersonaColours.Blue, label: _PersonaArchetypeLabel(PersonaColours.Blue), percentage: _Percentage(result.colourScores.blue, result.colourScores.total), tone: PersonaArchetypeTones.Analyst }
	];
}

/** Round one display-only percentage without changing score ordering or tie evidence. */
function _Percentage(value: number, total: number): number
{
	if (total <= 0)
	{
		return 0;
	}
	return Math.round((value / total) * 100);
}
