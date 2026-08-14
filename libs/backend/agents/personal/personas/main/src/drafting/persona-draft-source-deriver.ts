import { PersonaColourValues } from "../scoring/persona-scorer.types";

import { _CompilePersonaDraftInstructions } from "./persona-draft-instruction-compiler";
import { PersonaTemplateVariable, type PersonaTemplateVariables } from "./persona-draft-instruction-compiler.types";
import type { PersonaDraftDirectives, PersonaDraftSourceAnswer, PersonaDraftSourceDerivationInput, PersonaDraftSourceDerivationResult } from "./persona-draft-source-deriver.types";
import { _ParsePersonaDraftDirectives } from "./persona-draft-source-deriver.validator";

/** The question each template placeholder is filled from. */
const _VARIABLE_QUESTIONS = {
	[PersonaTemplateVariable.ResponseStyle]: "q2-response-preference",
	[PersonaTemplateVariable.FeedbackApproach]: "q3-feedback-preference",
	[PersonaTemplateVariable.ChallengeMode]: "q8-challenge-preference",
	[PersonaTemplateVariable.RelationshipFrame]: "q9-relationship-model",
} as const;

/** Validates the interpolation map, fills in the SOUL template from the owner's answers, and derives one insight per filled placeholder. Returns null when any step fails. */
export function _DerivePersonaDraftSources<Category>(input: PersonaDraftSourceDerivationInput<Category>): PersonaDraftSourceDerivationResult<Category> | null
{
	// 1. Validate the stored interpolation map before using any of its JSON as directive text.
	const directives = _ParsePersonaDraftDirectives(input.interpolationDirectives);
	if (directives === null) return null;

	// 2. Fill every template placeholder from one of the owner's answers.
	const answers = new Map(input.answers.map(function _Answer(answer) { return [answer.questionId, answer]; }));
	const variables = _Variables(answers, directives, input.secondaryColour);
	if (variables === null) return null;

	// 3. Fill in the template, then build one insight from each of those same four questions.
	const compiledInstructions = _CompilePersonaDraftInstructions(input.templateContent, variables);
	if (compiledInstructions === null) return null;
	const insights = _Insights(answers, directives, input.questionSetId, input.questionSetVersion);
	return insights === null ? null : { compiledInstructions, insights };
}

/** Resolves the four answer-driven placeholders plus the secondary-colour blend. Returns null when any of them has no directive text. */
function _Variables<Category>(answers: ReadonlyMap<string, PersonaDraftSourceAnswer<Category>>, directives: PersonaDraftDirectives, secondary: PersonaColourValues): PersonaTemplateVariables | null
{
	const resolved = {} as Record<keyof typeof _VARIABLE_QUESTIONS, string>;
	for (const [variable, questionId] of Object.entries(_VARIABLE_QUESTIONS) as readonly [keyof typeof _VARIABLE_QUESTIONS, string][])
	{
		const answer = answers.get(questionId);
		const directive = answer === undefined ? undefined : directives.byChoice[`${questionId}:${answer.choiceId}`];
		if (directive === undefined) return null;
		resolved[variable] = directive;
	}
	const secondaryBlend = directives.secondaryBlend[secondary];
	return secondaryBlend === undefined ? null : { ...resolved, [PersonaTemplateVariable.SecondaryBlend]: secondaryBlend };
}

/** Builds one insight per placeholder question, each recording the answer it came from. */
function _Insights<Category>(answers: ReadonlyMap<string, PersonaDraftSourceAnswer<Category>>, directives: PersonaDraftDirectives, questionSetId: string, questionSetVersion: number): PersonaDraftSourceDerivationResult<Category>["insights"] | null
{
	const insights = [] as PersonaDraftSourceDerivationResult<Category>["insights"][number][];
	for (const questionId of Object.values(_VARIABLE_QUESTIONS))
	{
		const answer = answers.get(questionId);
		const directive = answer === undefined ? undefined : directives.byChoice[`${questionId}:${answer.choiceId}`];
		if (answer === undefined || directive === undefined) return null;
		insights.push({ answerId: answer.answerId, statement: `${answer.choiceLabel} → ${directive}`, category: answer.category, questionSetId, questionSetVersion, questionId });
	}
	return insights;
}
