import { UserOnboardingStates } from "./user-onboarding.enums.js";

/** Reusable deterministic guided-chat projection schema. */
const _ChatProjectionSchema = {
	type: "object",
	required: ["workflowVersion", "state", "conversationId", "persona", "contentRevision", "transcript", "currentQuestion", "answerCount", "questionCount", "canConclude", "startedAt", "completedAt"],
	properties: {
		workflowVersion: { type: "integer", minimum: 1 },
		state: { type: "string", enum: Object.values(UserOnboardingStates) },
		conversationId: { type: "string", nullable: true },
		persona: { type: "object", nullable: true, required: ["revisionId", "displayName", "archetype", "primaryColour"], properties: { revisionId: { type: "string" }, displayName: { type: "string" }, archetype: { type: "string", enum: ["commander", "catalyst", "anchor", "analyst"] }, primaryColour: { type: "string", enum: ["red", "yellow", "green", "blue"] } } },
		contentRevision: { type: "object", nullable: true, required: ["id", "digest", "sourceLabel"], properties: { id: { type: "string" }, digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" }, sourceLabel: { type: "string" } } },
		transcript: { type: "array", items: { type: "object", required: ["ordinal", "role", "kind", "text", "questionOrdinal"], properties: { ordinal: { type: "integer", minimum: 1 }, role: { type: "string", enum: ["assistant", "user"] }, kind: { type: "string", enum: ["opening", "question", "answer"] }, text: { type: "string" }, questionOrdinal: { type: "integer", minimum: 1, maximum: 3, nullable: true } } } },
		currentQuestion: { type: "object", nullable: true, required: ["ordinal", "text"], properties: { ordinal: { type: "integer", minimum: 1, maximum: 3 }, text: { type: "string" } } },
		answerCount: { type: "integer", minimum: 0, maximum: 3 },
		questionCount: { type: "integer", enum: [0, 3] },
		canConclude: { type: "boolean" },
		startedAt: { type: "string", format: "date-time", nullable: true },
		completedAt: { type: "string", format: "date-time", nullable: true },
	},
} as const;

/** Bounded error-only response returned when no authoritative recovery projection is available. */
const _ChatErrorSchema = { type: "object", additionalProperties: false, required: ["error"], properties: { error: { type: "string" } } } as const;

/** Answer conflict response carrying the authoritative projection needed to recover stale clients. */
const _AnswerConflictSchema = { type: "object", additionalProperties: false, required: ["error", "chat"], properties: { error: { type: "string" }, chat: _ChatProjectionSchema } } as const;

/** Common guided-chat responses for authenticated owner endpoints. */
const _ChatResponses = {
	200: { description: "Current deterministic guided onboarding chat.", content: { "application/json": { schema: _ChatProjectionSchema } } },
	400: { description: "Malformed or out-of-bounds owner input." },
	401: { description: "Authentication required." },
	409: { description: "Current workflow, answer ordering, idempotency, or conclusion conflict." },
	503: { description: "Required onboarding, persona, or script evidence unavailable." },
} as const;

/** OpenAPI fragment for durable owner routing state and deterministic guided chat. */
export const _UserOnboardingOpenapiPaths = {
	"/me/onboarding": {
		get: {
			operationId: "getMyOnboardingStatus",
			summary: "Return the signed-in owner's durable onboarding route",
			responses: {
				200: { description: "Server-owned workflow state.", content: { "application/json": { schema: { type: "object", required: ["workflowVersion", "state", "personaInterviewId", "personaRevisionId", "bootstrapConversationId", "startedAt", "updatedAt", "completedAt"], properties: { workflowVersion: { type: "integer", minimum: 1 }, state: { type: "string", enum: Object.values(UserOnboardingStates) }, personaInterviewId: { type: "string", nullable: true }, personaRevisionId: { type: "string", nullable: true }, bootstrapConversationId: { type: "string", nullable: true }, startedAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" }, completedAt: { type: "string", format: "date-time", nullable: true } } } } } },
				401: { description: "Authentication required." },
				503: { description: "Onboarding authority unavailable." },
			},
		},
	},
	"/me/onboarding/chat": { get: { operationId: "getMyOnboardingChat", summary: "Return the deterministic guided onboarding exchange", responses: _ChatResponses } },
	"/me/onboarding/chat/start": { post: { operationId: "startMyOnboardingChat", summary: "Start or resume the server-selected guided onboarding exchange", responses: _ChatResponses } },
	"/me/onboarding/chat/answers": {
		post: {
			operationId: "answerMyOnboardingChatQuestion",
			summary: "Append one bounded answer to the current server-selected question",
			requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["expectedConversationId", "expectedQuestionOrdinal", "text", "idempotencyKey"], properties: { expectedConversationId: { type: "string", minLength: 1, maxLength: 128 }, expectedQuestionOrdinal: { type: "integer", minimum: 1, maximum: 3 }, text: { type: "string", minLength: 1, maxLength: 4000 }, idempotencyKey: { type: "string", minLength: 1, maxLength: 128 } } } } } },
			responses: { ..._ChatResponses, 201: { description: "One new answer was durably appended.", content: { "application/json": { schema: _ChatProjectionSchema } } }, 409: { description: "Stale question, workflow, or idempotency conflict, with the current chat when recoverable.", content: { "application/json": { schema: { oneOf: [_AnswerConflictSchema, _ChatErrorSchema] } } } } },
		},
	},
	"/me/onboarding/chat/conclude": { post: { operationId: "concludeMyOnboardingChat", summary: "Complete onboarding after exactly three valid answers", responses: _ChatResponses } },
} as const;
