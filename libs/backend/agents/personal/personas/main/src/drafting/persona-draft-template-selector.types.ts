/** Deterministic reviewed SOUL-template selection evidence stored on a draft revision. */
export interface PersonaDraftTemplateSelection
{
	/** Stable reviewed template identity. */
	readonly templateId: string;
	/** Immutable reviewed template version. */
	readonly templateVersion: number;
	/** Content fingerprint pinned to the draft. */
	readonly templateDigest: string;
	/** Reviewed template text used as the instruction source. */
	readonly content: string;
	/** Reviewed matching rule identity. */
	readonly selectionRuleId: string;
	/** Sorted answer identities proving this exact rule matched. */
	readonly selectionAnswerIds: readonly string[];
}

/** Parsed reviewed rule that the deterministic selector may interpret from persisted JSON. */
export interface PersonaDraftTemplateRule
{
	/** Stable rule identifier retained as durable selection evidence. */
	readonly id: string;
	/** Integer priority whose larger values outrank smaller values. */
	readonly priority: number;
	/** Exact question-to-answer values that every matching interview must contain. */
	readonly answers: Readonly<Record<string, string>>;
}

/** Persisted JSON representation accepted before rule validation and numeric normalization. */
export interface PersonaDraftTemplateRuleJson
{
	/** Candidate rule identifier read from the reviewed catalogue. */
	readonly id: string;
	/** JSON number or canonical integer string accepted by the database contract. */
	readonly priority: number | string;
	/** Candidate exact-answer predicates read from the reviewed catalogue. */
	readonly answers: Readonly<Record<string, string>>;
}

/** Typed read port used by deterministic template selection inside an existing persona transaction. */
export interface PersonaDraftTemplateSelectorRepository
{
	/** Selects the sole highest-priority reviewed template for one completed interview, or null fail-closed. */
	select(interviewId: string): Promise<PersonaDraftTemplateSelection | null>;
}
