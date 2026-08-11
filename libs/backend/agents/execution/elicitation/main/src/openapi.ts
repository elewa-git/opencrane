import { ElicitationBodyKinds, ElicitationPurposes, ElicitationRequestStates } from "@opencrane/contracts";

/** Shared choice schema used by both supported choice bodies. */
const _CHOICE_SCHEMA = { type: "object", additionalProperties: false, required: ["value", "label"], properties: { value: { type: "string" }, label: { type: "string" }, description: { type: "string" } } } as const;

/** Exact four browser-safe body shapes. */
const _BODY_SCHEMA = { oneOf: [
	{ type: "object", additionalProperties: false, required: ["kind", "prompt", "action", "target", "dataUse", "consequence"], properties: { kind: { const: ElicitationBodyKinds.Approval }, prompt: { type: "string" }, action: { type: "string" }, target: { type: "string" }, dataUse: { type: "string" }, externalSystem: { type: "string" }, consequence: { type: "string" }, cost: { type: "string" } } },
	{ type: "object", additionalProperties: false, required: ["kind", "prompt", "choices"], properties: { kind: { const: ElicitationBodyKinds.SingleChoice }, prompt: { type: "string" }, choices: { type: "array", items: _CHOICE_SCHEMA } } },
	{ type: "object", additionalProperties: false, required: ["kind", "prompt", "choices", "minimumSelections", "maximumSelections"], properties: { kind: { const: ElicitationBodyKinds.MultipleChoice }, prompt: { type: "string" }, choices: { type: "array", items: _CHOICE_SCHEMA }, minimumSelections: { type: "integer" }, maximumSelections: { type: "integer" } } },
	{ type: "object", additionalProperties: false, required: ["kind", "prompt", "maximumLength", "allowEmpty"], properties: { kind: { const: ElicitationBodyKinds.FreeText }, prompt: { type: "string" }, maximumLength: { type: "integer" }, allowEmpty: { type: "boolean" } } },
] } as const;

/** Exact four response shapes accepted by the generated client. */
const _RESPONSE_VALUE_SCHEMA = { oneOf: [
	{ type: "object", additionalProperties: false, required: ["kind", "approved"], properties: { kind: { const: ElicitationBodyKinds.Approval }, approved: { type: "boolean" } } },
	{ type: "object", additionalProperties: false, required: ["kind", "selection"], properties: { kind: { const: ElicitationBodyKinds.SingleChoice }, selection: { type: "string" } } },
	{ type: "object", additionalProperties: false, required: ["kind", "selections"], properties: { kind: { const: ElicitationBodyKinds.MultipleChoice }, selections: { type: "array", items: { type: "string" } } } },
	{ type: "object", additionalProperties: false, required: ["kind", "text"], properties: { kind: { const: ElicitationBodyKinds.FreeText }, text: { type: "string" } } },
] } as const;

/** Browser-safe canonical elicitation projection with no protected purpose payload. */
const _ELICITATION_SCHEMA = { type: "object", additionalProperties: false, required: ["version", "requestId", "conversationId", "runId", "attempt", "assignedParticipantId", "purpose", "state", "body", "requiresStepUp", "requestedAt", "expiresAt"], properties: { version: { const: "opencrane.elicitation.v1" }, requestId: { type: "string" }, conversationId: { type: "string" }, runId: { type: "string" }, attempt: { type: "integer", minimum: 1 }, assignedParticipantId: { type: "string" }, purpose: { type: "string", enum: Object.values(ElicitationPurposes) }, state: { type: "string", enum: Object.values(ElicitationRequestStates) }, body: _BODY_SCHEMA, requiresStepUp: { type: "boolean" }, requestedAt: { type: "string", format: "date-time" }, expiresAt: { type: "string", format: "date-time" }, resolvedAt: { type: "string", format: "date-time" }, safeReason: { type: "string" } } } as const;

/** Authoritative terminal response acknowledgement. */
const _RESPONSE_PROJECTION_SCHEMA = { type: "object", additionalProperties: false, required: ["requestId", "state", "idempotent", "resolvedAt"], properties: { requestId: { type: "string" }, state: { type: "string", enum: Object.values(ElicitationRequestStates) }, idempotent: { type: "boolean" }, resolvedAt: { type: "string", format: "date-time" } } } as const;

/** OpenAPI paths for the single conversation-scoped elicitation surface. */
export const _ElicitationOpenapiPaths = {
	"/me/activity/elicitations": {
		get: {
			operationId: "listMyElicitationActivity",
			summary: "List recent participant-input activity",
			description: "Derives a bounded index from canonical elicitation references. It does not copy the transcript or expose protected purpose payloads.",
			tags: ["Conversations"],
			parameters: [{ name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } }],
			responses: {
				200: { description: "Recent owned elicitation references.", content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["elicitations"], properties: { elicitations: { type: "array", items: _ELICITATION_SCHEMA } } } } } },
				400: _Error("The requested Activity limit is invalid."),
				401: _Error("No authenticated browser session owns the Activity index."),
				503: _Error("The elicitation Activity index is temporarily unavailable."),
			},
		},
	},
	"/me/conversations/{conversationId}/elicitations/{requestId}": {
		get: {
			operationId: "getMyConversationElicitation",
			summary: "Read one participant-input request",
			description: "Returns the browser-safe request only to its active assigned participant. Protected purpose payloads, dataset identifiers, credentials, and resume material are never returned.",
			tags: ["Conversations"],
			parameters: _Parameters(),
			responses: {
				200: { description: "Owned request.", content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["elicitation"], properties: { elicitation: _ELICITATION_SCHEMA } } } } },
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
			requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["idempotencyKey", "response"], properties: { idempotencyKey: { type: "string", minLength: 1, maxLength: 200 }, response: _RESPONSE_VALUE_SCHEMA } } } } },
			responses: {
				200: { description: "Answer accepted or replayed idempotently.", content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["response"], properties: { response: _RESPONSE_PROJECTION_SCHEMA } } } } },
				400: _Error("The response does not match the exact request body."),
				401: _Error("No authenticated browser session owns the request."),
				403: _Error("The caller is not the active assigned participant."),
				404: _Error("The request is absent."),
				409: _Error("The request is terminal, expired, or conflicts with an idempotent retry."),
				428: { description: "Fresh verified OpenID Connect reauthentication is required.", content: { "application/json": { schema: { type: "object", required: ["error", "reauthenticatePath"], properties: { error: { type: "string", const: "elicitation_step_up_required" }, reauthenticatePath: { type: "string", const: "/api/v1/auth/reauthenticate" } } } } } },
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
