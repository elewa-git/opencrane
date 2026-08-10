import { PersonaColourValues, PersonaModifierValues, PersonaTieKinds, type PersonaAuthoritativeScoreResult, type PersonaScoreReplayEvidence, type PersonaScoreResult, type PersonaSelectionValue, type PersonaTieChoice, type PersonaWeightedAnswer } from "./persona-scorer.types.js";

/** Stable product order used only to present equal candidates, never to resolve them. */
const _COLOUR_ORDER: readonly PersonaColourValues[] = [PersonaColourValues.Red, PersonaColourValues.Yellow, PersonaColourValues.Green, PersonaColourValues.Blue];

/** Canonical lifecycle order shared with durable approval evidence. */
const _TIE_KIND_ORDER: Readonly<Record<PersonaTieKinds, number>> = { [PersonaTieKinds.Primary]: 1, [PersonaTieKinds.Secondary]: 2, [PersonaTieKinds.Modifier]: 3 };

/** Accumulate reviewed weights and resolve only ties backed by exact owner evidence. */
export function _ScorePersona(answers: readonly PersonaWeightedAnswer[], resolutions: readonly PersonaTieChoice[]): PersonaAuthoritativeScoreResult | null
{
	if (answers.length === 0 || !_ValidAnswers(answers)) return null;
	const colours = {
		red: _Sum(answers, PersonaColourValues.Red),
		yellow: _Sum(answers, PersonaColourValues.Yellow),
		green: _Sum(answers, PersonaColourValues.Green),
		blue: _Sum(answers, PersonaColourValues.Blue),
		total: 0,
	};
	const openness = { explorer: _Sum(answers, PersonaModifierValues.Explorer), guardian: _Sum(answers, PersonaModifierValues.Guardian), total: 0 };
	colours.total = colours.red + colours.yellow + colours.green + colours.blue;
	openness.total = openness.explorer + openness.guardian;
	return _ReplayPersonaScore({ orderedAnswerIds: answers.map(function _AnswerId(answer) { return answer.answerId; }), orderedChoiceIds: answers.map(function _ChoiceId(answer) { return `${answer.questionId}:${answer.choiceId}`; }), colours, openness, tieResolutions: resolutions });
}

/** Replay persisted counters and tie evidence through the same governed selection algorithm. */
export function _ReplayPersonaScore(evidence: PersonaScoreReplayEvidence): PersonaAuthoritativeScoreResult | null
{
	const { orderedAnswerIds, orderedChoiceIds, colours, openness, tieResolutions: resolutions } = evidence;
	if (!_ValidReplayEvidence(evidence)) return null;
	const progress = new _PersonaScoreProgress();

	// 1. Advance the explicit Primary -> Secondary -> Modifier resolution lifecycle in reviewed order.
	for (const state of _TIE_RESOLUTION_STATES)
	{
		const candidates = state.candidates(colours, openness, progress);
		state.recordCandidates(progress, candidates);
		if (candidates.length === 1 && _HasResolution(state.kind, resolutions)) return null;
		const selected = state.resolve(candidates, resolutions);
		if (selected === null) return _Result(orderedAnswerIds, orderedChoiceIds, resolutions, colours, openness, progress, { kind: state.kind, candidates });
		state.recordSelection(progress, selected);
	}

	return _Result(orderedAnswerIds, orderedChoiceIds, resolutions, colours, openness, progress, null);
}

/** Mutable progress carried only while replaying one immutable score evidence set. */
class _PersonaScoreProgress
{
	/** Primary colour selected by the first resolution state. */
	primary: PersonaColourValues | null = null;
	/** Secondary colour selected by the second resolution state. */
	secondary: PersonaColourValues | null = null;
	/** Working-style modifier selected by the final resolution state. */
	modifier: PersonaModifierValues | null = null;
	/** Candidate sets reached in the governed state order. */
	candidateEvidence: { primary: PersonaColourValues[]; secondary: PersonaColourValues[]; modifier: PersonaModifierValues[] } = { primary: [], secondary: [], modifier: [] };
}

/** Shared state contract for one ordered governed persona tie boundary. */
abstract class _PersonaTieResolutionState<Value extends PersonaSelectionValue>
{
	/** Persisted boundary vocabulary owned by this state. */
	abstract readonly kind: PersonaTieKinds;

	/** Derive the candidates that may be selected at this exact lifecycle boundary. */
	abstract candidates(colours: PersonaScoreResult["colours"], openness: PersonaScoreResult["openness"], progress: _PersonaScoreProgress): readonly Value[];

	/** Retain this state's candidate evidence before any user selection is accepted. */
	abstract recordCandidates(progress: _PersonaScoreProgress, candidates: readonly Value[]): void;

	/** Retain one valid state-owned selection in the shared score progress. */
	abstract recordSelection(progress: _PersonaScoreProgress, selection: Value): void;

	/** Narrow a persisted selection to this state's own vocabulary. */
	abstract accepts(value: PersonaSelectionValue): value is Value;

	/** Resolve one unambiguous candidate or exact persisted owner choice. */
	resolve(candidates: readonly Value[], resolutions: readonly PersonaTieChoice[]): Value | null
	{
		if (candidates.length === 1) return candidates[0] ?? null;
		const kind = this.kind;
		const resolution = resolutions.find(function _Matching(item) { return item.kind === kind; });
		if (resolution === undefined || !this.accepts(resolution.selectedValue)) return null;
		if (!_SameCandidates(resolution.candidates, candidates)) return null;
		return candidates.includes(resolution.selectedValue) ? resolution.selectedValue : null;
	}
}

/** First lifecycle state: select the highest colour without using a stale tie choice. */
class _PrimaryTieResolutionState extends _PersonaTieResolutionState<PersonaColourValues>
{
	/** Persisted discriminator for the primary-colour boundary. */
	readonly kind = PersonaTieKinds.Primary;

	/** Derive all highest colour counters in stable display order. */
	candidates(colours: PersonaScoreResult["colours"]): readonly PersonaColourValues[]
	{
		return _TopColours(colours, null);
	}

	/** Retain primary candidates for later durable evidence. */
	recordCandidates(progress: _PersonaScoreProgress, candidates: readonly PersonaColourValues[]): void
	{
		progress.candidateEvidence.primary = [...candidates];
	}

	/** Retain the selected primary colour. */
	recordSelection(progress: _PersonaScoreProgress, selection: PersonaColourValues): void
	{
		progress.primary = selection;
	}

	/** Accept only the colour vocabulary at the primary boundary. */
	accepts(value: PersonaSelectionValue): value is PersonaColourValues
	{
		return _IsColour(value);
	}
}

/** Second lifecycle state: select the highest colour remaining after primary selection. */
class _SecondaryTieResolutionState extends _PersonaTieResolutionState<PersonaColourValues>
{
	/** Persisted discriminator for the secondary-colour boundary. */
	readonly kind = PersonaTieKinds.Secondary;

	/** Derive remaining highest colours only after primary has been selected. */
	candidates(colours: PersonaScoreResult["colours"], openness: PersonaScoreResult["openness"], progress: _PersonaScoreProgress): readonly PersonaColourValues[]
	{
		return _TopColours(colours, progress.primary);
	}

	/** Retain secondary candidates for later durable evidence. */
	recordCandidates(progress: _PersonaScoreProgress, candidates: readonly PersonaColourValues[]): void
	{
		progress.candidateEvidence.secondary = [...candidates];
	}

	/** Retain the selected secondary colour. */
	recordSelection(progress: _PersonaScoreProgress, selection: PersonaColourValues): void
	{
		progress.secondary = selection;
	}

	/** Accept only the colour vocabulary at the secondary boundary. */
	accepts(value: PersonaSelectionValue): value is PersonaColourValues
	{
		return _IsColour(value);
	}
}

/** Final lifecycle state: select the Explorer or Guardian modifier after colours are fixed. */
class _ModifierTieResolutionState extends _PersonaTieResolutionState<PersonaModifierValues>
{
	/** Persisted discriminator for the modifier boundary. */
	readonly kind = PersonaTieKinds.Modifier;

	/** Derive the modifier candidates without inventing an implicit tie breaker. */
	candidates(colours: PersonaScoreResult["colours"], openness: PersonaScoreResult["openness"]): readonly PersonaModifierValues[]
	{
		return _ModifierCandidates(openness);
	}

	/** Retain modifier candidates for later durable evidence. */
	recordCandidates(progress: _PersonaScoreProgress, candidates: readonly PersonaModifierValues[]): void
	{
		progress.candidateEvidence.modifier = [...candidates];
	}

	/** Retain the selected working-style modifier. */
	recordSelection(progress: _PersonaScoreProgress, selection: PersonaModifierValues): void
	{
		progress.modifier = selection;
	}

	/** Accept only the modifier vocabulary at the final boundary. */
	accepts(value: PersonaSelectionValue): value is PersonaModifierValues
	{
		return _IsModifier(value);
	}
}

/** Ordered strategy dispatch for the only permitted persona tie-resolution lifecycle. */
const _TIE_RESOLUTION_STATES: readonly _PersonaTieResolutionState<PersonaSelectionValue>[] = [new _PrimaryTieResolutionState(), new _SecondaryTieResolutionState(), new _ModifierTieResolutionState()];

/** Validate persisted score inputs before selecting classifications from them. */
function _ValidReplayEvidence(evidence: PersonaScoreReplayEvidence): boolean
{
	const colourValues = [evidence.colours.red, evidence.colours.yellow, evidence.colours.green, evidence.colours.blue];
	const opennessValues = [evidence.openness.explorer, evidence.openness.guardian];
	return evidence.orderedAnswerIds.length > 0
		&& evidence.orderedAnswerIds.length === evidence.orderedChoiceIds.length
		&& evidence.orderedAnswerIds.every(function _Present(value) { return value.trim().length > 0; })
		&& evidence.orderedChoiceIds.every(function _Present(value) { return value.trim().length > 0; })
		&& new Set(evidence.tieResolutions.map(function _Kind(resolution) { return resolution.kind; })).size === evidence.tieResolutions.length
		&& colourValues.every(function _Counter(value) { return Number.isSafeInteger(value) && value >= 0; })
		&& opennessValues.every(function _Counter(value) { return Number.isSafeInteger(value) && value >= 0; })
		&& evidence.colours.total === colourValues.reduce(function _SumCounters(total, value) { return total + value; }, 0)
		&& evidence.openness.total === opennessValues.reduce(function _SumCounters(total, value) { return total + value; }, 0)
		&& evidence.colours.total > 0 && evidence.openness.total > 0;
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
function _Sum(answers: readonly PersonaWeightedAnswer[], counter: PersonaSelectionValue): number
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

/** Return one unambiguous modifier or both candidates when owner evidence must break a tie. */
function _ModifierCandidates(openness: PersonaScoreResult["openness"]): readonly PersonaModifierValues[]
{
	if (openness.explorer === openness.guardian) return [PersonaModifierValues.Explorer, PersonaModifierValues.Guardian];
	if (openness.explorer > openness.guardian) return [PersonaModifierValues.Explorer];
	return [PersonaModifierValues.Guardian];
}

/** Require byte-for-byte candidate-set equality so stale resolutions cannot be replayed. */
function _SameCandidates(left: readonly PersonaSelectionValue[], right: readonly PersonaSelectionValue[]): boolean
{
	return left.length === right.length && left.every(function _Same(value, index) { return value === right[index]; });
}

/** Narrow one governed selection value to the colour vocabulary. */
function _IsColour(value: PersonaSelectionValue): value is PersonaColourValues
{
	return Object.values(PersonaColourValues).some(function _Same(candidate) { return candidate === value; });
}

/** Narrow one governed selection value to the modifier vocabulary. */
function _IsModifier(value: PersonaSelectionValue): value is PersonaModifierValues
{
	return Object.values(PersonaModifierValues).some(function _Same(candidate) { return candidate === value; });
}

/** Assemble one immutable score projection from ordered answer evidence. */
function _Result(orderedAnswerIds: readonly string[], orderedChoiceIds: readonly string[], resolutions: readonly PersonaTieChoice[], colours: PersonaScoreResult["colours"], openness: PersonaScoreResult["openness"], progress: _PersonaScoreProgress, resolutionRequired: PersonaScoreResult["resolutionRequired"]): PersonaAuthoritativeScoreResult
{
	const orderedResolutions = [...resolutions].sort(function _GovernedOrder(left, right) { return _TIE_KIND_ORDER[left.kind] - _TIE_KIND_ORDER[right.kind]; });
	return { orderedAnswerIds: [...orderedAnswerIds], orderedChoiceIds: [...orderedChoiceIds], colours, openness, candidateEvidence: { primary: [...progress.candidateEvidence.primary], secondary: [...progress.candidateEvidence.secondary], modifier: [...progress.candidateEvidence.modifier] }, tieResolutions: orderedResolutions.map(function _Resolution(resolution) { return { ...resolution, candidates: [...resolution.candidates] }; }), primary: progress.primary, secondary: progress.secondary, modifier: progress.modifier, resolutionRequired };
}
