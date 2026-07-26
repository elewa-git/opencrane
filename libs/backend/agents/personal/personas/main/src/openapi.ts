/** OpenAPI fragment for resumable owner-only persona onboarding state. */
export const _PersonaOnboardingOpenapiPaths = {
	"/me/persona": {
		get: {
			operationId: "getMyPersonaOnboarding",
			summary: "Return the signed-in owner's resumable persona onboarding state",
			tags: ["Persona"],
			responses: {
				200: { description: "Durable onboarding progress without compiled persona instructions.", content: { "application/json": { schema: { type: "object", required: ["state", "interviewId", "answeredQuestionCount", "questionCount", "personaRevisionId"], properties: { state: { type: "string", enum: ["interview", "review", "ready"] }, interviewId: { type: "string", nullable: true }, answeredQuestionCount: { type: "integer", minimum: 0 }, questionCount: { type: "integer", minimum: 0 }, personaRevisionId: { type: "string", nullable: true } } } } } },
				401: { description: "No browser session owns the request.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				503: { description: "Onboarding status could not be read.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
			},
		},
	},
};
