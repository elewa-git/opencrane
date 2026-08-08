/** Reviewed placeholder names accepted by every persona SOUL template. */
export type PersonaTemplateVariable = "response_style" | "feedback_approach" | "challenge_mode" | "relationship_frame" | "secondary_blend";

/** Reviewed directive values selected only from exact quiz choices. */
export type PersonaTemplateVariables = Readonly<Record<PersonaTemplateVariable, string>>;
