/** Build one JSON response entry referencing the central error envelope. */
function _Error(description: string)
{
	return { description, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
}

/** Build one successful JSON response entry from a bounded schema. */
function _Json(description: string, schema: object)
{
	return { description, content: { "application/json": { schema } } };
}

/** OpenAPI path fragments owned by the personal persona onboarding domain. */
export const _PersonaOnboardingOpenapiPaths = {
	"/personas/onboarding/questions": {
		get: {
			operationId: "getPersonaOnboardingQuestions",
			summary: "Read the reviewed personal-agent onboarding questions",
			tags: ["Personal personas"],
			responses: {
				200: _Json("Reviewed onboarding question set.", { type: "object", required: ["questionSet"], properties: { questionSet: { $ref: "#/components/schemas/PersonaOnboardingQuestionSet" } } }),
				401: _Error("No authenticated personal owner."),
				503: _Error("The clean-build reviewed onboarding source is unavailable."),
			},
		},
	},
	"/personas/onboarding/interviews": {
		post: {
			operationId: "startPersonaOnboardingInterview",
			summary: "Start or resume the caller's reviewed persona interview",
			tags: ["Personal personas"],
			requestBody: { required: false, content: { "application/json": { schema: { type: "object", additionalProperties: false } } } },
			responses: {
				200: _Json("Existing in-progress interview reused.", { $ref: "#/components/schemas/PersonaInterviewStart" }),
				201: _Json("New reviewed interview started.", { $ref: "#/components/schemas/PersonaInterviewStart" }),
				400: _Error("The request must not supply owner or source coordinates."),
				401: _Error("No authenticated personal owner."),
				503: _Error("Persona onboarding authority or source unavailable."),
			},
		},
	},
	"/personas/onboarding/interviews/{interviewId}/answers": {
		post: {
			operationId: "recordPersonaOnboardingAnswer",
			summary: "Append one answer to the caller's in-progress persona interview",
			tags: ["Personal personas"],
			parameters: [{ name: "interviewId", in: "path", required: true, schema: { type: "string" } }],
			requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/PersonaInterviewAnswerInput" } } } },
			responses: { 201: _Json("Answer appended once.", { type: "object", required: ["answerId"], properties: { answerId: { type: "string" } } }), 400: _Error("Invalid bounded answer input."), 401: _Error("No authenticated personal owner."), 404: _Error("Interview or question unavailable."), 409: _Error("Interview no longer accepts this answer."), 503: _Error("Persona authority unavailable.") },
		},
	},
	"/personas/onboarding/interviews/{interviewId}/complete": {
		post: {
			operationId: "completePersonaOnboardingInterview",
			summary: "Freeze the caller's fully answered persona interview",
			tags: ["Personal personas"],
			parameters: [{ name: "interviewId", in: "path", required: true, schema: { type: "string" } }],
			requestBody: { required: false, content: { "application/json": { schema: { type: "object", additionalProperties: false } } } },
			responses: { 200: _Json("Interview frozen for draft derivation.", { type: "object", required: ["completed"], properties: { completed: { type: "boolean", const: true } } }), 400: _Error("Invalid completion request."), 401: _Error("No authenticated personal owner."), 404: _Error("Interview unavailable."), 409: _Error("Interview is incomplete or no longer in progress."), 503: _Error("Persona authority unavailable.") },
		},
	},
	"/personas/onboarding/interviews/{interviewId}/draft": {
		post: {
			operationId: "createPersonaDraft",
			summary: "Create a reviewable persona draft from three to five answer-bound insights",
			tags: ["Personal personas"],
			parameters: [{ name: "interviewId", in: "path", required: true, schema: { type: "string" } }],
			requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/PersonaDraftInput" } } } },
			responses: { 201: _Json("Reviewable draft created.", { type: "object", required: ["personaRevisionId"], properties: { personaRevisionId: { type: "string" } } }), 400: _Error("Invalid insight input."), 401: _Error("No authenticated personal owner."), 404: _Error("Interview unavailable."), 409: _Error("Completed evidence cannot derive a draft."), 503: _Error("Persona authority unavailable.") },
		},
	},
	"/personas/revisions/{personaRevisionId}/approve": {
		post: {
			operationId: "approvePersonaRevision",
			summary: "Approve and atomically activate the caller's fully evidenced persona draft",
			tags: ["Personal personas"],
			parameters: [{ name: "personaRevisionId", in: "path", required: true, schema: { type: "string" } }],
			requestBody: { required: false, content: { "application/json": { schema: { type: "object", additionalProperties: false } } } },
			responses: { 200: _Json("Draft approved and activated.", { type: "object", required: ["approved"], properties: { approved: { type: "boolean", const: true } } }), 400: _Error("Invalid approval request."), 401: _Error("No authenticated personal owner."), 404: _Error("Draft unavailable."), 409: _Error("Draft evidence no longer permits approval.") },
		},
	},
};
