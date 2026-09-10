import { PersonaFirstChatArchetypes } from "@opencrane/models/user-onboarding";
import { PersonaColours, PersonaModifiers, PersonaResolutionKinds, type PersonaQuestion } from "@opencrane/state/onboarding";

import { _LOCAL_DEVELOPMENT_SCORING_WEIGHTS } from "./local-development.persona-fixtures";
import type { _LocalDevelopmentScore, _LocalDevelopmentScoreSelection, _LocalDevelopmentScoringWeight, _LocalDevelopmentTieChoice } from "./local-development.scoring.types";

/** Stable candidate order used by the reviewed version-one scorer. */
const _COLOUR_ORDER: readonly PersonaColours[] = [PersonaColours.Red, PersonaColours.Yellow, PersonaColours.Green, PersonaColours.Blue];

/** Adds every selected answer into the six reviewed counters. */
function _Totals(questions: readonly PersonaQuestion[]): _LocalDevelopmentScoringWeight
{
	const totals = { red: 0, yellow: 0, green: 0, blue: 0, explorer: 0, guardian: 0 };
	for (const question of questions)
	{
		if (question.selectedChoiceId === null)
		{
			throw new Error("Complete every local interview question first.");
		}
		const weight = _LOCAL_DEVELOPMENT_SCORING_WEIGHTS[`${question.id}:${question.selectedChoiceId}`];
		if (weight === undefined)
		{
			throw new Error("The local interview answer is not part of the reviewed scoring policy.");
		}
		totals.red += weight.red;
		totals.yellow += weight.yellow;
		totals.green += weight.green;
		totals.blue += weight.blue;
		totals.explorer += weight.explorer;
		totals.guardian += weight.guardian;
	}
	return totals;
}

/** Returns every highest remaining colour in current product order. */
function _TopColours(colours: _LocalDevelopmentScore["colours"], excluded: PersonaColours | null): readonly PersonaColours[]
{
	const available = _COLOUR_ORDER.filter(function _Available(colour) { return colour !== excluded; });
	const highest = Math.max(...available.map(function _Score(colour) { return colours[colour]; }));
	return available.filter(function _Highest(colour) { return colours[colour] === highest; });
}

/** Returns the winning working style or both tied candidates. */
function _ModifierCandidates(openness: _LocalDevelopmentScore["openness"]): readonly PersonaModifiers[]
{
	if (openness.explorer === openness.guardian)
	{
		return [PersonaModifiers.Explorer, PersonaModifiers.Guardian];
	}
	if (openness.explorer > openness.guardian)
	{
		return [PersonaModifiers.Explorer];
	}
	return [PersonaModifiers.Guardian];
}

/** Selects a sole candidate or the owner's matching reviewed tie choice. */
function _ResolveSelection<Selection extends _LocalDevelopmentScoreSelection>(kind: PersonaResolutionKinds, candidates: readonly Selection[], resolutions: readonly _LocalDevelopmentTieChoice[]): Selection | null
{
	if (candidates.length === 1)
	{
		return candidates[0] ?? null;
	}
	const resolution = resolutions.find(function _Match(candidate) { return candidate.kind === kind; });
	if (resolution === undefined || !candidates.includes(resolution.selectedValue as Selection))
	{
		return null;
	}
	return resolution.selectedValue as Selection;
}

/** Scores all ten answers and stops at the first unresolved current tie boundary. */
export function _ScoreLocalDevelopmentPersona(questions: readonly PersonaQuestion[], resolutions: readonly _LocalDevelopmentTieChoice[]): _LocalDevelopmentScore
{
	const totals = _Totals(questions);
	const colours = { red: totals.red, yellow: totals.yellow, green: totals.green, blue: totals.blue, total: totals.red + totals.yellow + totals.green + totals.blue };
	const openness = { explorer: totals.explorer, guardian: totals.guardian, total: totals.explorer + totals.guardian };
	const primaryCandidates = _TopColours(colours, null);
	const primary = _ResolveSelection(PersonaResolutionKinds.Primary, primaryCandidates, resolutions);
	if (primary === null)
	{
		return { colours, openness, primary, secondary: null, modifier: null, resolution: { kind: PersonaResolutionKinds.Primary, candidates: primaryCandidates } };
	}
	const secondaryCandidates = _TopColours(colours, primary);
	const secondary = _ResolveSelection(PersonaResolutionKinds.Secondary, secondaryCandidates, resolutions);
	if (secondary === null)
	{
		return { colours, openness, primary, secondary, modifier: null, resolution: { kind: PersonaResolutionKinds.Secondary, candidates: secondaryCandidates } };
	}
	const modifierCandidates = _ModifierCandidates(openness);
	const modifier = _ResolveSelection(PersonaResolutionKinds.Modifier, modifierCandidates, resolutions);
	if (modifier === null)
	{
		return { colours, openness, primary, secondary, modifier, resolution: { kind: PersonaResolutionKinds.Modifier, candidates: modifierCandidates } };
	}
	return { colours, openness, primary, secondary, modifier, resolution: null };
}

/** Maps the current primary colour onto the four reviewed first-chat archetypes. */
export function _LocalDevelopmentArchetype(primary: PersonaColours): PersonaFirstChatArchetypes
{
	const archetypes: Readonly<Record<PersonaColours, PersonaFirstChatArchetypes>> =
	{
		[PersonaColours.Red]: PersonaFirstChatArchetypes.Commander,
		[PersonaColours.Yellow]: PersonaFirstChatArchetypes.Catalyst,
		[PersonaColours.Green]: PersonaFirstChatArchetypes.Anchor,
		[PersonaColours.Blue]: PersonaFirstChatArchetypes.Analyst
	};
	return archetypes[primary];
}
