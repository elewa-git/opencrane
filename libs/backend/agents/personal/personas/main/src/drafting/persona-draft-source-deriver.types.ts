import type { PersonaColourValues } from "../scoring/persona-scorer.types.js";

import type { PersonaDraftInsightEvidence } from "./persona-draft-persistence.types.js";

/** Reviewed interpolation data parsed from the immutable persona catalogue. */
export interface PersonaDraftDirectives
{
	/** Exact question-and-choice coordinates mapped to reviewed directive text. */
	readonly byChoice: Readonly<Record<string, string>>;
	/** Reviewed directive text for each possible secondary colour. */
	readonly secondaryBlend: Readonly<Record<PersonaColourValues, string>>;
}

/** One reviewed answer projected out of the persona transaction for pure draft derivation. */
export interface PersonaDraftSourceAnswer<Category>
{
	/** Immutable answer identity retained as insight provenance. */
	readonly answerId: string;
	/** Reviewed question identity used by the interpolation map. */
	readonly questionId: string;
	/** Reviewed choice identity used by the interpolation map. */
	readonly choiceId: string;
	/** Reviewed display label used to explain the derived insight. */
	readonly choiceLabel: string;
	/** Question category retained on the resulting insight. */
	readonly category: Category;
}

/** Complete reviewed source snapshot consumed by the pure draft derivation policy. */
export interface PersonaDraftSourceDerivationInput<Category>
{
	/** Reviewed question-set identity retained on every derived insight. */
	readonly questionSetId: string;
	/** Reviewed question-set version retained on every derived insight. */
	readonly questionSetVersion: number;
	/** Reviewed template content selected by resolved primary colour and modifier. */
	readonly templateContent: string;
	/** Persisted reviewed interpolation map, treated as untrusted until validated here. */
	readonly interpolationDirectives: unknown;
	/** Resolved secondary colour used by the reviewed blend directive. */
	readonly secondaryColour: PersonaColourValues;
	/** Exact completed-interview answers and provenance. */
	readonly answers: readonly PersonaDraftSourceAnswer<Category>[];
}

/** Pure compiled instructions and provenance insights ready for atomic persistence. */
export interface PersonaDraftSourceDerivationResult<Category>
{
	/** Exact immutable runtime instructions compiled from reviewed sources. */
	readonly compiledInstructions: string;
	/** Four reviewed answer-linked explanations of the derived collaboration preferences. */
	readonly insights: readonly PersonaDraftInsightEvidence<Category>[];
}
