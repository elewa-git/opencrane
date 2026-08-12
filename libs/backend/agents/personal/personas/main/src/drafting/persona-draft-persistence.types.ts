/** One server-derived insight, together with the question and answer it came from. */
export interface PersonaDraftInsightEvidence<Category>
{
	/** Exact completed-interview answer from which the statement is derived. */
	readonly answerId: string;
	/** Owner-visible statement derived from the reviewed choice and its interpolation directive. */
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
