import { PersonaColourValues, PersonaModifierValues, PersonaTieKinds, type PersonaAuthoritativeScoreResult, type PersonaScoreReplayEvidence, type PersonaScoreResult, type PersonaSelectionValue, type PersonaTieChoice, type PersonaWeightedAnswer } from "./persona-scorer.types.js";

/** Fixed display order for the four colours. Used only to list tied candidates; it never decides which one wins. */
const _COLOUR_ORDER: readonly PersonaColourValues[] = [PersonaColourValues.Red, PersonaColourValues.Yellow, PersonaColourValues.Green, PersonaColourValues.Blue];

/** Sort order for tie choices: primary, then secondary, then modifier. The score JSON stored on a revision is sorted this way, and approval compares it in the same order. */
const _TIE_KIND_ORDER: Readonly<Record<PersonaTieKinds, number>> = { [PersonaTieKinds.Primary]: 1, [PersonaTieKinds.Secondary]: 2, [PersonaTieKinds.Modifier]: 3 };

/**
 * Scores a persona from the owner's answers and any tie choices they have already made.
 *
 * Adds up the six counters across every answer, then works through the three ties in a fixed order:
 * primary colour, secondary colour, modifier. A tie is only broken when the owner has recorded a
 * choice for exactly that tie, against exactly the candidate list this run produced. Nothing here
 * ever picks a winner on its own, so the same answers always give the same result.
 *
 * Called by: `PrismaPersonaScoringRepository.ensureScore`, `.readScore` and `.resolveTie`. Every
 * caller runs it twice — once with the owner's tie choices and once with none — because the row stores
 * the candidate lists from the choice-free run.
 *
 * @param answers - The owner's answers with the scoring weights of each chosen choice.
 * @param resolutions - Tie choices already recorded, at most one per tie.
 * @returns The score, whose `resolutionRequired` is null only when all three ties are settled — the
 * caller must check it before drafting. `null` when the answers are unusable: none supplied, a blank
 * identifier, a question answered twice, or a negative or non-integer weight. A `null` is a data
 * problem, not a tie, and the caller must not retry it.
 * @see PersonaAuthoritativeScoreResult
 */
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

/**
 * Recomputes a persona result from already-stored counters and tie choices.
 *
 * Runs exactly the same three tie steps as {@link _ScorePersona}, but starts from stored counters
 * rather than re-adding the answers. That is what lets the code check a stored score is still the one
 * the answers produce: if a stored row or JSON document has drifted, the recomputed colours and
 * modifier will not match and the caller refuses.
 *
 * Called by: {@link _ScorePersona} (it delegates the tie steps here) and
 * `_ParsePersonaPersistedScoreEvidence` in persona-scorer.validator.ts.
 *
 * @param evidence - Stored answer and choice ids, the raw counters with their totals, and the tie
 * choices made so far.
 * @returns The recomputed score, whose `resolutionRequired` is null only when all three ties are
 * settled. `null` when the stored inputs do not check out: no answer ids, mismatched id list lengths,
 * a blank id, the same tie recorded twice, a negative or non-integer counter, a total that does not
 * equal its parts, or a zero total. A `null` means the stored evidence is untrustworthy and must not
 * be shown to the owner.
 */
export function _ReplayPersonaScore(evidence: PersonaScoreReplayEvidence): PersonaAuthoritativeScoreResult | null
{
	const { orderedAnswerIds, orderedChoiceIds, colours, openness, tieResolutions: resolutions } = evidence;
	if (!_ValidReplayEvidence(evidence)) return null;
	const progress = new _PersonaScoreProgress();

	// 1. Work through the ties in a fixed order: primary colour, then secondary colour, then modifier.
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

/** Scratch state held while one score is being computed, then thrown away. */
class _PersonaScoreProgress
{
	/** Primary colour selected by the first resolution state. */
	primary: PersonaColourValues | null = null;
	/** Secondary colour selected by the second resolution state. */
	secondary: PersonaColourValues | null = null;
	/** Working-style modifier selected by the final resolution state. */
	modifier: PersonaModifierValues | null = null;
	/** The candidate list found at each tie, in the order the ties were handled. */
	candidateEvidence: { primary: PersonaColourValues[]; secondary: PersonaColourValues[]; modifier: PersonaModifierValues[] } = { primary: [], secondary: [], modifier: [] };
}

/** Base class for one tie: how its candidates are found, recorded, and resolved. */
abstract class _PersonaTieResolutionState<Value extends PersonaSelectionValue>
{
	/** Which tie this class handles. The same value is stored on the tie-resolution row. */
	abstract readonly kind: PersonaTieKinds;

	/** Works out the candidates the owner could be asked to choose from at this tie. */
	abstract candidates(colours: PersonaScoreResult["colours"], openness: PersonaScoreResult["openness"], progress: _PersonaScoreProgress): readonly Value[];

	/** Records this tie's candidate list before any owner choice is applied. */
	abstract recordCandidates(progress: _PersonaScoreProgress, candidates: readonly Value[]): void;

	/** Stores the value chosen for this tie on the shared progress object. */
	abstract recordSelection(progress: _PersonaScoreProgress, selection: Value): void;

	/** Returns whether a stored value belongs to this tie's set of values. */
	abstract accepts(value: PersonaSelectionValue): value is Value;

	/** Returns the single candidate when there is no tie, or the owner's stored choice when it names the same candidate list. Returns null while the tie is still open. */
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

/** First tie: the highest colour counter. A stored choice is used only while its candidate list still matches. */
class _PrimaryTieResolutionState extends _PersonaTieResolutionState<PersonaColourValues>
{
	/** Value stored on the tie row for the primary-colour tie. */
	readonly kind = PersonaTieKinds.Primary;

	/** Returns every colour tied for the highest counter, in display order. */
	candidates(colours: PersonaScoreResult["colours"]): readonly PersonaColourValues[]
	{
		return _TopColours(colours, null);
	}

	/** Records the primary candidates so they can be stored with the score. */
	recordCandidates(progress: _PersonaScoreProgress, candidates: readonly PersonaColourValues[]): void
	{
		progress.candidateEvidence.primary = [...candidates];
	}

	/** Retain the selected primary colour. */
	recordSelection(progress: _PersonaScoreProgress, selection: PersonaColourValues): void
	{
		progress.primary = selection;
	}

	/** Accepts only colour values for this tie. */
	accepts(value: PersonaSelectionValue): value is PersonaColourValues
	{
		return _IsColour(value);
	}
}

/** Second tie: the highest colour counter left once the primary colour is taken out. */
class _SecondaryTieResolutionState extends _PersonaTieResolutionState<PersonaColourValues>
{
	/** Persisted discriminator for the secondary-colour boundary. */
	readonly kind = PersonaTieKinds.Secondary;

	/** Returns the highest colours left, excluding the primary colour already chosen. */
	candidates(colours: PersonaScoreResult["colours"], openness: PersonaScoreResult["openness"], progress: _PersonaScoreProgress): readonly PersonaColourValues[]
	{
		return _TopColours(colours, progress.primary);
	}

	/** Records the secondary candidates so they can be stored with the score. */
	recordCandidates(progress: _PersonaScoreProgress, candidates: readonly PersonaColourValues[]): void
	{
		progress.candidateEvidence.secondary = [...candidates];
	}

	/** Retain the selected secondary colour. */
	recordSelection(progress: _PersonaScoreProgress, selection: PersonaColourValues): void
	{
		progress.secondary = selection;
	}

	/** Accepts only colour values for this tie. */
	accepts(value: PersonaSelectionValue): value is PersonaColourValues
	{
		return _IsColour(value);
	}
}

/** Third tie: Explorer or Guardian, handled once both colours are settled. */
class _ModifierTieResolutionState extends _PersonaTieResolutionState<PersonaModifierValues>
{
	/** Persisted discriminator for the modifier boundary. */
	readonly kind = PersonaTieKinds.Modifier;

	/** Returns the winning modifier, or both when the counters are equal. This code never picks a winner itself. */
	candidates(colours: PersonaScoreResult["colours"], openness: PersonaScoreResult["openness"]): readonly PersonaModifierValues[]
	{
		return _ModifierCandidates(openness);
	}

	/** Records the modifier candidates so they can be stored with the score. */
	recordCandidates(progress: _PersonaScoreProgress, candidates: readonly PersonaModifierValues[]): void
	{
		progress.candidateEvidence.modifier = [...candidates];
	}

	/** Retain the selected working-style modifier. */
	recordSelection(progress: _PersonaScoreProgress, selection: PersonaModifierValues): void
	{
		progress.modifier = selection;
	}

	/** Accepts only modifier values for this tie. */
	accepts(value: PersonaSelectionValue): value is PersonaModifierValues
	{
		return _IsModifier(value);
	}
}

/** The three ties in the only order they may be handled: primary, secondary, then modifier. */
const _TIE_RESOLUTION_STATES: readonly _PersonaTieResolutionState<PersonaSelectionValue>[] = [new _PrimaryTieResolutionState(), new _SecondaryTieResolutionState(), new _ModifierTieResolutionState()];

/** Returns whether stored score inputs are usable: counters are non-negative whole numbers, each total equals its parts, and no tie appears twice. */
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

/** Returns whether the owner already recorded a choice for this tie. */
function _HasResolution(kind: PersonaTieKinds, resolutions: readonly PersonaTieChoice[]): boolean
{
	return resolutions.some(function _Matching(resolution) { return resolution.kind === kind; });
}

/** Returns whether every answer has its identifiers, answers a question only once, and carries non-negative whole-number weights. */
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

/** Adds up one counter across every answer. */
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

/** Returns the higher-scoring modifier, or both when the counters are equal. */
function _ModifierCandidates(openness: PersonaScoreResult["openness"]): readonly PersonaModifierValues[]
{
	if (openness.explorer === openness.guardian) return [PersonaModifierValues.Explorer, PersonaModifierValues.Guardian];
	if (openness.explorer > openness.guardian) return [PersonaModifierValues.Explorer];
	return [PersonaModifierValues.Guardian];
}

/** Returns whether two candidate lists are identical in value and order, so a choice recorded against a different list is rejected. */
function _SameCandidates(left: readonly PersonaSelectionValue[], right: readonly PersonaSelectionValue[]): boolean
{
	return left.length === right.length && left.every(function _Same(value, index) { return value === right[index]; });
}

/** Returns whether the value is one of the four colours. */
function _IsColour(value: PersonaSelectionValue): value is PersonaColourValues
{
	return Object.values(PersonaColourValues).some(function _Same(candidate) { return candidate === value; });
}

/** Returns whether the value is Explorer or Guardian. */
function _IsModifier(value: PersonaSelectionValue): value is PersonaModifierValues
{
	return Object.values(PersonaModifierValues).some(function _Same(candidate) { return candidate === value; });
}

/** Builds the final score result, copying every list and sorting the tie choices primary, secondary, modifier. */
function _Result(orderedAnswerIds: readonly string[], orderedChoiceIds: readonly string[], resolutions: readonly PersonaTieChoice[], colours: PersonaScoreResult["colours"], openness: PersonaScoreResult["openness"], progress: _PersonaScoreProgress, resolutionRequired: PersonaScoreResult["resolutionRequired"]): PersonaAuthoritativeScoreResult
{
	const orderedResolutions = [...resolutions].sort(function _GovernedOrder(left, right) { return _TIE_KIND_ORDER[left.kind] - _TIE_KIND_ORDER[right.kind]; });
	return { orderedAnswerIds: [...orderedAnswerIds], orderedChoiceIds: [...orderedChoiceIds], colours, openness, candidateEvidence: { primary: [...progress.candidateEvidence.primary], secondary: [...progress.candidateEvidence.secondary], modifier: [...progress.candidateEvidence.modifier] }, tieResolutions: orderedResolutions.map(function _Resolution(resolution) { return { ...resolution, candidates: [...resolution.candidates] }; }), primary: progress.primary, secondary: progress.secondary, modifier: progress.modifier, resolutionRequired };
}
