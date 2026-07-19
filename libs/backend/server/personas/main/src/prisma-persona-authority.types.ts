/** Locked persona profile evidence read from the canonical database. */
export interface PersonaProfileAuthorityRow
{
	/** Stable profile identifier. */
	readonly id: string;
	/** User who owns the profile. */
	readonly userId: string;
}

/** Locked persona revision evidence read from the canonical database. */
export interface PersonaRevisionAuthorityRow
{
	/** Stable revision identifier. */
	readonly id: string;
	/** Profile that owns the revision. */
	readonly personaProfileId: string;
	/** Current lifecycle state. */
	readonly state: "draft" | "approved";
	/** Interview that produced the revision. */
	readonly interviewId: string;
	/** Template identity pinned by the revision. */
	readonly soulTemplateId: string;
	/** Template version pinned by the revision. */
	readonly soulTemplateVersion: number;
	/** Template digest pinned by the revision. */
	readonly soulTemplateDigest: string;
	/** Deterministic selection rule pinned by the revision. */
	readonly selectionRuleId: string;
	/** Exact interview answer evidence pinned by the revision. */
	readonly selectionAnswerIds: readonly string[];
	/** Fixed prohibition on runtime mutation of durable SOUL content. */
	readonly durableSoulMutationPolicy: string;
}

/** Locked interview evidence read from the canonical database. */
export interface PersonaInterviewAuthorityRow
{
	/** Current onboarding interview lifecycle state. */
	readonly state: "in_progress" | "completed" | "retaken";
}

/** Deterministic template candidate returned by the database selection rule. */
export interface PersonaTemplateSelectionCandidate
{
	/** Selected reviewed template identity. */
	readonly templateId: string;
	/** Selected reviewed template version. */
	readonly templateVersion: number;
	/** Exact reviewed template digest. */
	readonly templateDigest: string;
	/** Winning deterministic selection rule. */
	readonly ruleId: string;
	/** Answer ids which prove the rule matched. */
	readonly answerIds: readonly string[];
}
