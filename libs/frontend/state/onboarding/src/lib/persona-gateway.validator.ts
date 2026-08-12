import { z } from "zod";

import { PersonaColours, PersonaModifiers, PersonaOnboardingSnapshot, PersonaOnboardingStates, PersonaQuestion, PersonaQuestionChoice, PersonaResolution, PersonaResolutionKinds, PersonaResult } from "./persona-gateway.types";

/**
 * Runtime checks for every persona response, kept next to the model they validate.
 *
 * One definition of a valid response, so the generated HTTP client and the browser state cannot end
 * up accepting different shapes or different rules about which stage allows which fields.
 *
 * Fields the frontend does not use are dropped on purpose rather than passed through, so a new
 * server field cannot silently reach the UI without someone adding it here.
 */

/** Most questions accepted in one interview response. */
const _MAXIMUM_QUESTIONS = 64;

/** One answer choice, with its length limits applied. */
const _PersonaQuestionChoiceSchema: z.ZodType<PersonaQuestionChoice> = z.object({
	id: z.string().min(1).max(256),
	label: z.string().min(1).max(512),
	ordinal: z.number().int().min(1)
}).strip();

/** One question with its length limits applied, plus the choice recorded for it if any. */
const _PersonaQuestionSchema: z.ZodType<PersonaQuestion> = z.object({
	id: z.string().min(1).max(256),
	category: z.string().min(1).max(128),
	prompt: z.string().min(1).max(2_000),
	ordinal: z.number().int().min(1),
	choices: z.array(_PersonaQuestionChoiceSchema).min(2).max(32),
	selectedChoiceId: z.string().min(1).max(256).nullable()
}).strip().superRefine(function _ValidateSelectedChoice(question, context)
{
	if (question.selectedChoiceId !== null && !question.choices.some(function _Matches(choice) { return choice.id === question.selectedChoiceId; }))
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["selectedChoiceId"], message: "must name a reviewed choice from this question" });
	}
});

/** The tie the server is asking the user to break, and the candidates it will accept. */
const _PersonaResolutionSchema: z.ZodType<PersonaResolution> = z.object({
	kind: z.nativeEnum(PersonaResolutionKinds),
	candidates: z.array(z.union([z.nativeEnum(PersonaColours), z.nativeEnum(PersonaModifiers)])).min(2).max(6)
}).strip().superRefine(function _ValidateResolutionCandidates(resolution, context)
{
	const candidatesMatchKind = resolution.kind === PersonaResolutionKinds.Modifier
		? resolution.candidates.every(function _Modifier(candidate) { return Object.values(PersonaModifiers).includes(candidate as PersonaModifiers); })
		: resolution.candidates.every(function _Colour(candidate) { return Object.values(PersonaColours).includes(candidate as PersonaColours); });
	if (!candidatesMatchKind) context.addIssue({ code: z.ZodIssueCode.custom, path: ["candidates"], message: "must match the tie boundary" });
});

/** Raw colour point counts, none of them negative. */
const _PersonaColourScoresSchema = z.object({
	red: z.number().int().nonnegative(),
	yellow: z.number().int().nonnegative(),
	green: z.number().int().nonnegative(),
	blue: z.number().int().nonnegative(),
	total: z.number().int().positive()
}).strip().superRefine(function _ValidateColourTotal(scores, context)
{
	if (scores.total !== scores.red + scores.yellow + scores.green + scores.blue) context.addIssue({ code: z.ZodIssueCode.custom, path: ["total"], message: "must equal the colour score sum" });
});

/** Lossless non-negative openness vector returned for persona review. */
const _PersonaOpennessScoresSchema = z.object({
	explorer: z.number().int().nonnegative(),
	guardian: z.number().int().nonnegative(),
	total: z.number().int().positive()
}).strip().superRefine(function _ValidateOpennessTotal(scores, context)
{
	if (scores.total !== scores.explorer + scores.guardian) context.addIssue({ code: z.ZodIssueCode.custom, path: ["total"], message: "must equal the openness score sum" });
});

/** The persona result; when the instruction preview is present it is guaranteed non-empty. */
const _PersonaResultSchema: z.ZodType<PersonaResult> = z.object({
	displayName: z.string().min(1).max(512),
	primaryColour: z.nativeEnum(PersonaColours),
	secondaryColour: z.nativeEnum(PersonaColours),
	modifier: z.nativeEnum(PersonaModifiers),
	colourScores: _PersonaColourScoresSchema,
	opennessScores: _PersonaOpennessScoresSchema,
	insights: z.array(z.string().min(1).max(4_000)).max(5),
	instructionPreview: z.string().min(1).max(100_000).nullable()
}).strip();

/** The whole persona response, including the checks that its stage and its fields agree. */
const _PersonaOnboardingSnapshotSchema: z.ZodType<PersonaOnboardingSnapshot> = z.object({
	state: z.nativeEnum(PersonaOnboardingStates),
	interviewId: z.string().min(1).max(256).nullable(),
	answeredQuestionCount: z.number().int().nonnegative().max(_MAXIMUM_QUESTIONS),
	questionCount: z.number().int().nonnegative().max(_MAXIMUM_QUESTIONS),
	personaRevisionId: z.string().min(1).max(256).nullable(),
	questions: z.array(_PersonaQuestionSchema).max(_MAXIMUM_QUESTIONS),
	resolution: _PersonaResolutionSchema.nullable(),
	result: _PersonaResultSchema.nullable()
}).strip().superRefine(function _ValidateSnapshot(snapshot, context)
{
	const selectedCount = snapshot.questions.filter(function _Answered(question) { return question.selectedChoiceId !== null; }).length;
	if (snapshot.questionCount !== snapshot.questions.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["questionCount"], message: "must match the frozen question set" });
	if (snapshot.answeredQuestionCount !== selectedCount) context.addIssue({ code: z.ZodIssueCode.custom, path: ["answeredQuestionCount"], message: "must match the immutable selected answers" });
	if (snapshot.state === PersonaOnboardingStates.Resolution && snapshot.resolution === null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["resolution"], message: "is required while resolving a tie" });
	if ((snapshot.state === PersonaOnboardingStates.Review || snapshot.state === PersonaOnboardingStates.Ready) && snapshot.result === null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["result"], message: "is required for persona review" });
	if (snapshot.state === PersonaOnboardingStates.Ready && snapshot.personaRevisionId === null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["personaRevisionId"], message: "is required for an active persona" });
	if (snapshot.personaRevisionId !== null && snapshot.result?.instructionPreview === null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["result", "instructionPreview"], message: "is required for an immutable persona revision" });
});

/** Parse one persona response, throwing before it can reach UI state if anything is wrong. */
export function _ParsePersonaOnboardingSnapshot(value: unknown): PersonaOnboardingSnapshot
{
	const parsed = _PersonaOnboardingSnapshotSchema.safeParse(value);
	if (parsed.success) return parsed.data;
	throw new Error("The persona authority returned an invalid onboarding projection.");
}
