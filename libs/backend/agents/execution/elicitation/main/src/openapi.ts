/** OpenAPI paths for the single conversation-scoped elicitation surface. */
export const _ElicitationOpenapiPaths = {
	"/me/conversations/{conversationId}/elicitations/{requestId}": {
		get: {
			operationId: "getMyConversationElicitation",
			summary: "Read one participant-input request",
			description: "Returns the browser-safe request only to its active assigned participant. Protected purpose payloads, dataset identifiers, credentials, and resume material are never returned.",
			tags: ["Conversations"],
			parameters: _Parameters(),
			responses: {
				200: { description: "Owned request.", content: { "application/json": { schema: { type: "object", required: ["elicitation"], properties: { elicitation: { type: "object" } } } } } },
				401: _Error("No authenticated browser session owns the request."),
				404: _Error("The request is absent or belongs to another participant."),
				503: _Error("The elicitation authority is temporarily unavailable."),
			},
		},
	},
	"/me/conversations/{conversationId}/elicitations/{requestId}/responses": {
		post: {
			operationId: "respondToMyConversationElicitation",
			summary: "Answer one participant-input request",
			description: "Submits one typed, idempotent answer. The server derives the actor, run, participant, purpose strategy, protected payload, and any verified step-up evidence.",
			tags: ["Conversations"],
			parameters: _Parameters(),
			requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["idempotencyKey", "response"], properties: { idempotencyKey: { type: "string", minLength: 1, maxLength: 200 }, response: { type: "object" } } } } } },
			responses: {
				200: { description: "Answer accepted or replayed idempotently.", content: { "application/json": { schema: { type: "object", required: ["response"], properties: { response: { type: "object" } } } } } },
				400: _Error("The response does not match the exact request body."),
				401: _Error("No authenticated browser session owns the request."),
				403: _Error("The caller is not the active assigned participant."),
				404: _Error("The request is absent."),
				409: _Error("The request is terminal, expired, or conflicts with an idempotent retry."),
				428: _Error("Fresh verified OpenID Connect reauthentication is required."),
				503: _Error("The elicitation authority is temporarily unavailable."),
			},
		},
	},
} as const;

/** Shared path coordinates. */
function _Parameters()
{
	return [
		{ name: "conversationId", in: "path", required: true, schema: { type: "string" }, description: "Conversation containing the request." },
		{ name: "requestId", in: "path", required: true, schema: { type: "string" }, description: "Opaque elicitation identifier." },
	] as const;
}

/** Build one bounded error response schema. */
function _Error(description: string)
{
	return { description, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
}
