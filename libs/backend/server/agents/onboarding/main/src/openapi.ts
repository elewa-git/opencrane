/** OpenAPI fragment for durable owner routing state. */
export const _UserOnboardingOpenapiPaths = {
	"/me/onboarding": {
		get: {
			operationId: "getMyOnboardingStatus",
			summary: "Return the signed-in owner's durable onboarding route",
			responses: {
				200: { description: "Server-owned workflow state.", content: { "application/json": { schema: { type: "object", required: ["workflowVersion", "state", "personaInterviewId", "personaRevisionId", "bootstrapConversationId", "startedAt", "updatedAt", "completedAt"], properties: { workflowVersion: { type: "integer", minimum: 1 }, state: { type: "string", enum: ["survey_pending", "survey_in_progress", "bootstrap_chat_pending", "bootstrap_chat_in_progress", "completed"] }, personaInterviewId: { type: "string", nullable: true }, personaRevisionId: { type: "string", nullable: true }, bootstrapConversationId: { type: "string", nullable: true }, startedAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" }, completedAt: { type: "string", format: "date-time", nullable: true } } } } } },
				401: { description: "Authentication required." },
				503: { description: "Onboarding authority unavailable." },
			},
		},
	},
} as const;
