/** One reviewed question in the product-owned first persona interview. */
export interface PersonaOnboardingQuestion
{
	/** Stable identifier referenced by template selection rules. */
	readonly id: string;
	/** Persona behaviour dimension captured by the question. */
	readonly category: "RelationshipRole" | "ToneLanguage" | "AnswerStructure" | "ChallengeSupport" | "Initiative" | "ApprovalRisk" | "WorkingHabits" | "MemoryBoundaries";
	/** Owner-facing interview prompt. */
	readonly prompt: string;
	/** Stable presentation order. */
	readonly ordinal: number;
}

/** One immutable reviewed SOUL markdown source and its deterministic answer-selection rule. */
export interface PersonaOnboardingSoulTemplate
{
	/** Stable source identifier. */
	readonly id: string;
	/** Immutable source revision. */
	readonly version: number;
	/** Content fingerprint stored with every derived persona revision. */
	readonly digest: string;
	/** Reviewed SOUL.md source that becomes the start of compiled instructions. */
	readonly content: string;
	/** Database-validated selection rules matching exact interview answers. */
	readonly selectionRules: readonly { readonly id: string; readonly priority: number; readonly answers: Readonly<Record<string, string>> }[];
}
