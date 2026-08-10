import { z } from "zod";

import { _ReplayPersonaScore } from "./persona-scorer.js";
import { PersonaColourValues, PersonaModifierValues, type PersonaPersistedScoreEvidence, PersonaTieKinds } from "./persona-scorer.types.js";

/** Bounded list size for immutable persona interview evidence. */
const _MAXIMUM_EVIDENCE_ITEMS = 64;

/** One non-negative score vector that preserves its exact denominator. */
const _ColourScoresSchema = z.object({ red: z.number().int().nonnegative(), yellow: z.number().int().nonnegative(), green: z.number().int().nonnegative(), blue: z.number().int().nonnegative(), total: z.number().int().positive() }).strict().superRefine(function _Total(scores, context)
{
	if (scores.total !== scores.red + scores.yellow + scores.green + scores.blue) context.addIssue({ code: z.ZodIssueCode.custom, path: ["total"], message: "must equal the colour score sum" });
});

/** One non-negative modifier vector that preserves its exact denominator. */
const _OpennessScoresSchema = z.object({ explorer: z.number().int().nonnegative(), guardian: z.number().int().nonnegative(), total: z.number().int().positive() }).strict().superRefine(function _Total(scores, context)
{
	if (scores.total !== scores.explorer + scores.guardian) context.addIssue({ code: z.ZodIssueCode.custom, path: ["total"], message: "must equal the openness score sum" });
});

/** One exact owner tie resolution admitted before draft creation. */
const _TieChoiceSchema = z.object({ kind: z.nativeEnum(PersonaTieKinds), candidates: z.array(z.union([z.nativeEnum(PersonaColourValues), z.nativeEnum(PersonaModifierValues)])).min(2).max(6), selectedValue: z.union([z.nativeEnum(PersonaColourValues), z.nativeEnum(PersonaModifierValues)]) }).strict().superRefine(function _SelectedCandidate(resolution, context)
{
	if (!resolution.candidates.includes(resolution.selectedValue)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["selectedValue"], message: "must name an exact tie candidate" });
	const candidateKindMatches = resolution.kind === PersonaTieKinds.Modifier
		? resolution.candidates.every(function _Modifier(candidate) { return Object.values(PersonaModifierValues).includes(candidate as PersonaModifierValues); })
		: resolution.candidates.every(function _Colour(candidate) { return Object.values(PersonaColourValues).includes(candidate as PersonaColourValues); });
	if (!candidateKindMatches) context.addIssue({ code: z.ZodIssueCode.custom, path: ["candidates"], message: "must match the governed tie boundary" });
});

/** Model-adjacent parser for immutable JSON crossing from Prisma into owner-visible review state. */
const _PersistedScoreEvidenceSchema: z.ZodType<PersonaPersistedScoreEvidence> = z.object({
	orderedAnswerIds: z.array(z.string().min(1)).min(1).max(_MAXIMUM_EVIDENCE_ITEMS),
	orderedChoiceIds: z.array(z.string().min(1)).min(1).max(_MAXIMUM_EVIDENCE_ITEMS),
	colours: _ColourScoresSchema,
	openness: _OpennessScoresSchema,
	tieResolutions: z.array(_TieChoiceSchema).max(3),
	primary: z.nativeEnum(PersonaColourValues),
	secondary: z.nativeEnum(PersonaColourValues),
	modifier: z.nativeEnum(PersonaModifierValues),
}).strict().superRefine(function _MatchingEvidence(evidence, context)
{
	if (evidence.orderedAnswerIds.length !== evidence.orderedChoiceIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["orderedChoiceIds"], message: "must match the ordered answer evidence" });
	if (new Set(evidence.orderedAnswerIds).size !== evidence.orderedAnswerIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["orderedAnswerIds"], message: "must contain unique immutable answers" });
	if (new Set(evidence.tieResolutions.map(function _Kind(resolution) { return resolution.kind; })).size !== evidence.tieResolutions.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["tieResolutions"], message: "must contain each governed boundary at most once" });
	if (evidence.primary === evidence.secondary) context.addIssue({ code: z.ZodIssueCode.custom, path: ["secondary"], message: "must differ from the primary colour" });
});

/** Parse exact durable score evidence without trusting an unchecked JSON cast. */
export function _ParsePersonaPersistedScoreEvidence(value: unknown): PersonaPersistedScoreEvidence | null
{
	const parsed = _PersistedScoreEvidenceSchema.safeParse(value);
	if (!parsed.success) return null;
	const replayed = _ReplayPersonaScore(parsed.data);
	if (replayed === null || replayed.resolutionRequired !== null) return null;
	if (replayed.primary !== parsed.data.primary || replayed.secondary !== parsed.data.secondary || replayed.modifier !== parsed.data.modifier) return null;
	return parsed.data;
}
