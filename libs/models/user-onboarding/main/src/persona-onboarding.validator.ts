/**
 * Validates untrusted persona API bodies before adapters expose them as onboarding models.
 * Keeping these schemas beside `persona-onboarding.types.ts` makes lifecycle evidence and its
 * TypeScript contract change together instead of letting each HTTP adapter define a different
 * accepted response.
 */
import { z } from "zod";

import { PersonaColours, PersonaModifiers, PersonaOnboardingStates, PersonaResolutionKinds, type PersonaOnboardingSnapshot, type PersonaQuestion, type PersonaQuestionChoice, type PersonaResolution, type PersonaResult } from "./persona-onboarding.types";

/** Most questions accepted in one interview response. */
const _MAXIMUM_QUESTIONS = 64;

/** Checks one answer choice and its display limits. */
const _PersonaQuestionChoiceSchema: z.ZodType<PersonaQuestionChoice> = z.object({
	id: z.string().min(1).max(256),
	label: z.string().min(1).max(512),
	ordinal: z.number().int().min(1)
}).strip();

/** Checks one reviewed question and its selected choice. */
const _PersonaQuestionSchema: z.ZodType<PersonaQuestion> = z.object({
	id: z.string().min(1).max(256),
	category: z.string().min(1).max(128),
	prompt: z.string().min(1).max(2_000),
	ordinal: z.number().int().min(1),
	choices: z.array(_PersonaQuestionChoiceSchema).min(2).max(32),
	selectedChoiceId: z.string().min(1).max(256).nullable()
}).strip().superRefine(function _ValidateSelectedChoice(question, context)
{
	if (question.selectedChoiceId !== null && !question.choices.some(choice => choice.id === question.selectedChoiceId))
	{
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["selectedChoiceId"],
			message: "must name a reviewed choice from this question"
		});
	}
});

/** Checks the tie kind and every value offered for that tie. */
const _PersonaResolutionSchema: z.ZodType<PersonaResolution> = z.object({
	kind: z.nativeEnum(PersonaResolutionKinds),
	candidates: z.array(z.union([z.nativeEnum(PersonaColours), z.nativeEnum(PersonaModifiers)])).min(2).max(6)
}).strip().superRefine(function _ValidateResolutionCandidates(resolution, context)
{
	const candidatesMatchKind = resolution.kind === PersonaResolutionKinds.Modifier
		? resolution.candidates.every(candidate => Object.values(PersonaModifiers).includes(candidate as PersonaModifiers))
		: resolution.candidates.every(candidate => Object.values(PersonaColours).includes(candidate as PersonaColours));
	if (!candidatesMatchKind)
	{
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["candidates"],
			message: "must match the tie boundary"
		});
	}
});

/** Checks the non-negative colour counters and their total. */
const _PersonaColourScoresSchema = z.object({
	red: z.number().int().nonnegative(),
	yellow: z.number().int().nonnegative(),
	green: z.number().int().nonnegative(),
	blue: z.number().int().nonnegative(),
	total: z.number().int().positive()
}).strip().superRefine(function _ValidateColourTotal(scores, context)
{
	if (scores.total !== scores.red + scores.yellow + scores.green + scores.blue)
	{
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["total"],
			message: "must equal the colour score sum"
		});
	}
});

/** Checks the non-negative openness counters and their total. */
const _PersonaOpennessScoresSchema = z.object({
	explorer: z.number().int().nonnegative(),
	guardian: z.number().int().nonnegative(),
	total: z.number().int().positive()
}).strip().superRefine(function _ValidateOpennessTotal(scores, context)
{
	if (scores.total !== scores.explorer + scores.guardian)
	{
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["total"],
			message: "must equal the openness score sum"
		});
	}
});

/** Checks the server-computed persona result and its instruction preview. */
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

/** Checks the complete persona response and the fields required by each lifecycle state. */
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
	const selectedCount = snapshot.questions.filter(question => question.selectedChoiceId !== null).length;
	if (snapshot.questionCount !== snapshot.questions.length)
	{
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["questionCount"],
			message: "must match the frozen question set"
		});
	}
	if (snapshot.answeredQuestionCount !== selectedCount)
	{
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["answeredQuestionCount"],
			message: "must match the immutable selected answers"
		});
	}
	if (snapshot.state === PersonaOnboardingStates.Resolution && snapshot.resolution === null)
	{
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["resolution"],
			message: "is required while resolving a tie"
		});
	}
	if ((snapshot.state === PersonaOnboardingStates.Review || snapshot.state === PersonaOnboardingStates.Ready) && snapshot.result === null)
	{
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["result"],
			message: "is required for persona review"
		});
	}
	if (snapshot.state === PersonaOnboardingStates.Ready && snapshot.personaRevisionId === null)
	{
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["personaRevisionId"],
			message: "is required for an active persona"
		});
	}
	const hasPersonaRevision = Boolean(snapshot.personaRevisionId);
	const hasInstructionPreview = Boolean(snapshot.result?.instructionPreview);
	if (hasPersonaRevision !== hasInstructionPreview)
	{
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["result", "instructionPreview"],
			message: "must exist exactly when an immutable persona revision exists"
		});
	}
});

/**
 * Parses one untrusted persona response before it reaches frontend state.
 *
 * The parser strips unknown fields and enforces relationships between the lifecycle state, saved
 * answers, tie evidence, draft revision, and review result. Every frontend persona adapter that
 * accepts an untrusted response uses this model-owned boundary instead of maintaining its own
 * response checks.
 *
 * @param value - Untrusted response body returned by the persona API.
 * @returns The validated persona projection with unknown fields removed.
 * @throws Error when the response shape or lifecycle relationships are invalid.
 */
export function ___ParsePersonaOnboardingSnapshot(value: unknown): PersonaOnboardingSnapshot
{
	const parsed = _PersonaOnboardingSnapshotSchema.safeParse(value);
	if (parsed.success)
	{
		return parsed.data;
	}
	throw new Error("The persona authority returned an invalid onboarding projection.");
}
