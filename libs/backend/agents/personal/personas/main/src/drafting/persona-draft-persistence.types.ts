/** One immutable completed-interview answer used for template selection and insight derivation. */
export interface PersonaDraftInterviewAnswer
{
	/** Stable answer identifier persisted as evidence. */
	readonly id: string;
	/** Reviewed question-set identifier frozen with the answer. */
	readonly questionSetId: string;
	/** Reviewed question-set version frozen with the answer. */
	readonly questionSetVersion: number;
	/** Exact reviewed question answered by the owner. */
	readonly questionId: string;
	/** Immutable owner response used for exact rule matching. */
	readonly value: string;
}

/** Completed interview evidence read in the serializable draft transaction snapshot. */
export interface PersonaDraftCompletedInterview
{
	/** Reviewed question-set identifier frozen when the interview began. */
	readonly questionSetId: string;
	/** Reviewed question-set version frozen when the interview began. */
	readonly questionSetVersion: number;
	/** All immutable answers ordered by stable answer identifier. */
	readonly answers: readonly PersonaDraftInterviewAnswer[];
}

/** Immutable reviewed template source loaded through Prisma before deterministic selection. */
export interface PersonaDraftTemplateSource
{
	/** Reviewed template identifier. */
	readonly id: string;
	/** Reviewed template version. */
	readonly version: number;
	/** Immutable digest of the reviewed template content. */
	readonly digest: string;
	/** Reviewed SOUL instructions used as the draft base. */
	readonly content: string;
	/** Database-validated rule JSON that must still be parsed fail-closed at the adapter edge. */
	readonly selectionRules: unknown;
}

/** Parsed exact-answer rule owned by one reviewed template source. */
export interface PersonaDraftTemplateSelectionRule
{
	/** Stable rule identifier persisted with the selected draft. */
	readonly id: string;
	/** Higher values win before the database-supplied template and version ordering. */
	readonly priority: number;
	/** Exact required owner answers keyed by reviewed question identifier. */
	readonly answers: Readonly<Record<string, string>>;
}

/** Deterministic reviewed SOUL template selected from one completed interview. */
export interface PersonaDraftSelectedTemplate
{
	/** Reviewed template identifier. */
	readonly templateId: string;
	/** Reviewed template version. */
	readonly templateVersion: number;
	/** Immutable digest of the reviewed template content. */
	readonly templateDigest: string;
	/** Reviewed SOUL instructions used as the draft base. */
	readonly content: string;
	/** Exact selection rule that matched the frozen answers. */
	readonly selectionRuleId: string;
	/** Exact answer identifiers that satisfied the selection rule. */
	readonly selectionAnswerIds: readonly string[];
}

/** Matching template rule decorated with its priority for deterministic comparison. */
export interface PersonaDraftTemplateCandidate extends PersonaDraftSelectedTemplate
{
	/** Parsed rule priority used only while choosing the deterministic winner. */
	readonly priority: number;
}

/** One server-derived insight with the complete persisted question provenance. */
export interface PersonaDraftInsightEvidence<Category>
{
	/** Exact completed-interview answer from which the statement is derived. */
	readonly answerId: string;
	/** Owner-visible statement generated from the persisted answer value. */
	readonly statement: string;
	/** Reviewed question category carried into the persona insight. */
	readonly category: Category;
	/** Reviewed question-set identifier carried by the answer. */
	readonly questionSetId: string;
	/** Reviewed question-set version carried by the answer. */
	readonly questionSetVersion: number;
	/** Exact reviewed question answered by the owner. */
	readonly questionId: string;
}
