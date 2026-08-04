/** Owner profile coordinates retained while the next draft revision is allocated. */
export interface PersonaDraftProfileLock
{
	/** Currently active revision that becomes the immutable predecessor of the new draft. */
	readonly activeRevisionId: string | null;
}

/** Completed interview coordinates retained while its draft evidence is derived. */
export interface PersonaDraftInterviewLock
{
	/** Reviewed question-set identifier frozen when the interview began. */
	readonly questionSetId: string;
	/** Reviewed question-set version frozen when the interview began. */
	readonly questionSetVersion: number;
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
