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
