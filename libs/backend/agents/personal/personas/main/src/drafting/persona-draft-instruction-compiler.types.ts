/**
 * The placeholder names used in persona SOUL templates.
 *
 * These strings are stored inside the template content itself, so the compiler and the derivation
 * code must both read them from this enum rather than writing their own copies of the names.
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

/** The text filled into each placeholder, taken only from the owner's answers. */
export type PersonaTemplateVariables = Readonly<Record<PersonaTemplateVariable, string>>;
