import { PersonaColourValues } from "../scoring/persona-scorer.types.js";

import { _CompilePersonaDraftInstructions } from "./persona-draft-instruction-compiler.js";
import { PersonaTemplateVariable, type PersonaTemplateVariables } from "./persona-draft-instruction-compiler.types.js";
import type { PersonaDraftDirectives, PersonaDraftSourceAnswer, PersonaDraftSourceDerivationInput, PersonaDraftSourceDerivationResult } from "./persona-draft-source-deriver.types.js";
import { _ParsePersonaDraftDirectives } from "./persona-draft-source-deriver.validator.js";

/** Exact reviewed question coordinates that supply runtime interpolation and insight evidence. */
const _VARIABLE_QUESTIONS = {
	[PersonaTemplateVariable.ResponseStyle]: "q2-response-preference",
	[PersonaTemplateVariable.FeedbackApproach]: "q3-feedback-preference",
	[PersonaTemplateVariable.ChallengeMode]: "q8-challenge-preference",
	[PersonaTemplateVariable.RelationshipFrame]: "q9-relationship-model",
} as const;

/** Parse reviewed sources and derive exact runtime instructions plus answer-linked insights. */
export function _DerivePersonaDraftSources<Category>(input: PersonaDraftSourceDerivationInput<Category>): PersonaDraftSourceDerivationResult<Category> | null
{
	// 1. Validate the persisted interpolation map before treating any JSON value as reviewed policy.
	const directives = _ParsePersonaDraftDirectives(input.interpolationDirectives);
	if (directives === null) return null;

	// 2. Resolve every required template variable from one exact completed-interview answer.
	const answers = new Map(input.answers.map(function _Answer(answer) { return [answer.questionId, answer]; }));
	const variables = _Variables(answers, directives, input.secondaryColour);
	if (variables === null) return null;

	// 3. Compile the reviewed template and derive the same four coordinates as provenance insights.
	const compiledInstructions = _CompilePersonaDraftInstructions(input.templateContent, variables);
	if (compiledInstructions === null) return null;
	const insights = _Insights(answers, directives, input.questionSetId, input.questionSetVersion);
	return insights === null ? null : { compiledInstructions, insights };
}

/** Resolve all five variables from reviewed choice coordinates and the secondary score. */
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

/** Derive four provenance-linked insights from the same reviewed coordinates used at runtime. */
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
