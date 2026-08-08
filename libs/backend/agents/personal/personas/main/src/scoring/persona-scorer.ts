import { PersonaColourValues, PersonaModifierValues, PersonaTieKinds, type PersonaAuthoritativeScoreResult, type PersonaScoreCandidateEvidence, type PersonaScoreResult, type PersonaTieChoice, type PersonaWeightedAnswer } from "./persona-scorer.types.js";

/** Stable product order used only to present equal candidates, never to resolve them. */
const _COLOUR_ORDER: readonly PersonaColourValues[] = [PersonaColourValues.Red, PersonaColourValues.Yellow, PersonaColourValues.Green, PersonaColourValues.Blue];

/** Accumulate reviewed weights and resolve only ties backed by exact owner evidence. */
export function _ScorePersona(answers: readonly PersonaWeightedAnswer[], resolutions: readonly PersonaTieChoice[]): PersonaAuthoritativeScoreResult | null
{
	if (answers.length === 0 || !_ValidAnswers(answers)) return null;
	const colours = {
		red: _Sum(answers, "red"),
		yellow: _Sum(answers, "yellow"),
		green: _Sum(answers, "green"),
		blue: _Sum(answers, "blue"),
		total: 0,
	};
	const openness = { explorer: _Sum(answers, "explorer"), guardian: _Sum(answers, "guardian"), total: 0 };
	colours.total = colours.red + colours.yellow + colours.green + colours.blue;
	openness.total = openness.explorer + openness.guardian;
	if (colours.total <= 0 || openness.total <= 0) return null;

	// 1. Resolve the highest colour only from an exact persisted primary tie choice.
	const primaryCandidates = _TopColours(colours, null);
	if (primaryCandidates.length === 1 && _HasResolution(PersonaTieKinds.Primary, resolutions)) return null;
	const primary = _ResolveColour(PersonaTieKinds.Primary, primaryCandidates, resolutions);
	if (primary === null) return _Result(answers, resolutions, colours, openness, { primary: primaryCandidates, secondary: [], modifier: [] }, null, null, null, { kind: PersonaTieKinds.Primary, candidates: primaryCandidates });

	// 2. Resolve the highest remaining colour under the same fail-closed evidence rule.
	const secondaryCandidates = _TopColours(colours, primary);
	if (secondaryCandidates.length === 1 && _HasResolution(PersonaTieKinds.Secondary, resolutions)) return null;
	const secondary = _ResolveColour(PersonaTieKinds.Secondary, secondaryCandidates, resolutions);
	if (secondary === null) return _Result(answers, resolutions, colours, openness, { primary: primaryCandidates, secondary: secondaryCandidates, modifier: [] }, primary, null, null, { kind: PersonaTieKinds.Secondary, candidates: secondaryCandidates });

	// 3. Resolve the modifier last, keeping an exact tie out of draft creation.
	const modifierCandidates = openness.explorer === openness.guardian
		? [PersonaModifierValues.Explorer, PersonaModifierValues.Guardian]
		: [openness.explorer > openness.guardian ? PersonaModifierValues.Explorer : PersonaModifierValues.Guardian];
	if (modifierCandidates.length === 1 && _HasResolution(PersonaTieKinds.Modifier, resolutions)) return null;
	const modifier = _ResolveModifier(modifierCandidates, resolutions);
	return modifier === null
		? _Result(answers, resolutions, colours, openness, { primary: primaryCandidates, secondary: secondaryCandidates, modifier: modifierCandidates }, primary, secondary, null, { kind: PersonaTieKinds.Modifier, candidates: modifierCandidates })
		: _Result(answers, resolutions, colours, openness, { primary: primaryCandidates, secondary: secondaryCandidates, modifier: modifierCandidates }, primary, secondary, modifier, null);
}

/** Return whether a resolution exists for one boundary that did not require one. */
function _HasResolution(kind: PersonaTieKinds, resolutions: readonly PersonaTieChoice[]): boolean
{
	return resolutions.some(function _Matching(resolution) { return resolution.kind === kind; });
}

/** Validate non-negative integer weights and unique ordered question evidence. */
function _ValidAnswers(answers: readonly PersonaWeightedAnswer[]): boolean
{
	const questions = new Set<string>();
	for (const answer of answers)
	{
		if (!answer.answerId.trim() || !answer.questionId.trim() || !answer.choiceId.trim() || questions.has(answer.questionId)) return false;
		questions.add(answer.questionId);
		if (![answer.red, answer.yellow, answer.green, answer.blue, answer.explorer, answer.guardian].every(function _ValidWeight(weight) { return Number.isSafeInteger(weight) && weight >= 0; })) return false;
	}
	return true;
}

/** Sum one reviewed counter without presentation rounding. */
function _Sum(answers: readonly PersonaWeightedAnswer[], counter: "red" | "yellow" | "green" | "blue" | "explorer" | "guardian"): number
{
	return answers.reduce(function _Accumulate(total, answer) { return total + answer[counter]; }, 0);
}

/** Return every highest remaining colour in stable display order. */
function _TopColours(scores: { readonly red: number; readonly yellow: number; readonly green: number; readonly blue: number }, excluded: PersonaColourValues | null): readonly PersonaColourValues[]
{
	const available = _COLOUR_ORDER.filter(function _Available(colour) { return colour !== excluded; });
	const highest = Math.max(...available.map(function _Score(colour) { return scores[colour]; }));
	return available.filter(function _Highest(colour) { return scores[colour] === highest; });
}

/** Return an unambiguous colour or the matching exact resolution evidence. */
function _ResolveColour(kind: PersonaTieKinds.Primary | PersonaTieKinds.Secondary, candidates: readonly PersonaColourValues[], resolutions: readonly PersonaTieChoice[]): PersonaColourValues | null
{
	if (candidates.length === 1) return candidates[0] ?? null;
	const resolution = resolutions.find(function _Matching(item) { return item.kind === kind; });
	return resolution !== undefined && _SameCandidates(resolution.candidates, candidates) && candidates.includes(resolution.selectedValue as PersonaColourValues)
		? resolution.selectedValue as PersonaColourValues
		: null;
}

/** Return an unambiguous modifier or the matching exact resolution evidence. */
function _ResolveModifier(candidates: readonly PersonaModifierValues[], resolutions: readonly PersonaTieChoice[]): PersonaModifierValues | null
{
	if (candidates.length === 1) return candidates[0] ?? null;
	const resolution = resolutions.find(function _Matching(item) { return item.kind === PersonaTieKinds.Modifier; });
	return resolution !== undefined && _SameCandidates(resolution.candidates, candidates) && candidates.includes(resolution.selectedValue as PersonaModifierValues)
		? resolution.selectedValue as PersonaModifierValues
		: null;
}

/** Require byte-for-byte candidate-set equality so stale resolutions cannot be replayed. */
function _SameCandidates(left: readonly string[], right: readonly string[]): boolean
{
	return left.length === right.length && left.every(function _Same(value, index) { return value === right[index]; });
}

/** Assemble one immutable score projection from ordered answer evidence. */
function _Result(answers: readonly PersonaWeightedAnswer[], resolutions: readonly PersonaTieChoice[], colours: PersonaScoreResult["colours"], openness: PersonaScoreResult["openness"], candidateEvidence: PersonaScoreCandidateEvidence, primary: PersonaColourValues | null, secondary: PersonaColourValues | null, modifier: PersonaModifierValues | null, resolutionRequired: PersonaScoreResult["resolutionRequired"]): PersonaAuthoritativeScoreResult
{
	return { orderedAnswerIds: answers.map(function _AnswerId(answer) { return answer.answerId; }), orderedChoiceIds: answers.map(function _ChoiceId(answer) { return `${answer.questionId}:${answer.choiceId}`; }), colours, openness, candidateEvidence: { primary: [...candidateEvidence.primary], secondary: [...candidateEvidence.secondary], modifier: [...candidateEvidence.modifier] }, tieResolutions: resolutions.map(function _Resolution(resolution) { return { ...resolution, candidates: [...resolution.candidates] }; }), primary, secondary, modifier, resolutionRequired };
}
