/** Stable identifier for the product-owned first persona interview. */
export const PERSONA_ONBOARDING_QUESTION_SET_ID = "personal-agent-onboarding";

/** Immutable initial revision for the product-owned first persona interview. */
export const PERSONA_ONBOARDING_QUESTION_SET_VERSION = 1;

/** Exact reviewed answer choices that determine the initial SOUL template. */
export const PERSONA_ONBOARDING_TEMPLATE_ANSWERS = {
	relationshipRole: "A thoughtful partner",
	challengeSupport: ["Challenge me directly", "Start supportively, then challenge me"],
} as const;
