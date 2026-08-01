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

/** Typed read port used by deterministic template selection inside an existing persona transaction. */
export interface PersonaDraftTemplateSelectorRepository
{
	/** Selects the sole highest-priority reviewed template for one completed interview, or null fail-closed. */
	select(client: unknown, interviewId: string): Promise<PersonaDraftTemplateSelection | null>;
}
