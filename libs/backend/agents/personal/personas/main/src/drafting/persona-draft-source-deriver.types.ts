import type { PersonaColourValues } from "../scoring/persona-scorer.types.js";

import type { PersonaDraftInsightEvidence } from "./persona-draft-persistence.types.js";

/** The directive text parsed out of the stored interpolation map. */
export interface PersonaDraftDirectives
{
	/** Directive text keyed by `questionId:choiceId`. */
	readonly byChoice: Readonly<Record<string, string>>;
	/** Reviewed directive text for each possible secondary colour. */
	readonly secondaryBlend: Readonly<Record<PersonaColourValues, string>>;
}

/** One answer copied out of the database, so draft derivation needs no database access. */
export interface PersonaDraftSourceAnswer<Category>
{
	/** Answer identifier, recorded on the resulting insight. */
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

/** Everything draft derivation needs, read from the database beforehand. */
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
	/** The owner's answers from the completed interview, with the question and choice each one used. */
	readonly answers: readonly PersonaDraftSourceAnswer<Category>[];
}

/** The filled-in instructions and the derived insights, ready to store. */
export interface PersonaDraftSourceDerivationResult<Category>
{
	/** The SOUL instructions with every placeholder filled in. */
	readonly compiledInstructions: string;
	/** Four short explanations of the owner's collaboration preferences, one per placeholder question. */
	readonly insights: readonly PersonaDraftInsightEvidence<Category>[];
}
