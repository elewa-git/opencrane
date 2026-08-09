/**
 * Stable placeholder vocabulary shared by reviewed persona templates and draft source derivation.
 *
 * These strings are persisted inside reviewed template content, so compiler and derivation callers
 * must consume this enum instead of defining parallel placeholder names.
 */
export enum PersonaTemplateVariable
{
	/** Directs how the persona structures its response. */
	ResponseStyle = "response_style",
	/** Directs how the persona presents feedback and supporting evidence. */
	FeedbackApproach = "feedback_approach",
	/** Directs how the persona raises risks, objections, or alternatives. */
	ChallengeMode = "challenge_mode",
	/** Directs the collaborative relationship the persona adopts with its owner. */
	RelationshipFrame = "relationship_frame",
	/** Blends the resolved secondary colour into the selected persona template. */
	SecondaryBlend = "secondary_blend",
}

/** Reviewed directive values selected only from exact quiz choices. */
export type PersonaTemplateVariables = Readonly<Record<PersonaTemplateVariable, string>>;
