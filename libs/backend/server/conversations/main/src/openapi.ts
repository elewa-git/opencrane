/** OpenAPI path fragment for owner-bound canonical conversation timeline replay. */
export const _SelfConversationReplayOpenapiPaths = {
	"/me/conversations/{conversationId}/events": {
		get: {
			operationId: "replayMyConversationEvents",
			summary: "Replay the signed-in participant's canonical conversation events",
			description: "The server derives the participant and silo from the browser session. It streams display-safe canonical events only when that participant belongs to the selected conversation.",
			tags: ["Conversations"],
			parameters: [
				{ name: "conversationId", in: "path", required: true, schema: { type: "string" }, description: "Opaque conversation identifier." },
				{ name: "cursor", in: "query", required: false, schema: { type: "string" }, description: "Opaque canonical event cursor. The Last-Event-ID header is an equivalent resume mechanism." },
				{ name: "Last-Event-ID", in: "header", required: false, schema: { type: "string" }, description: "Opaque canonical event cursor. It must match cursor when both are supplied." },
			],
			responses: {
				200: { description: "A bounded text/event-stream replay. An empty stream does not disclose whether the conversation exists or belongs to another participant.", content: { "text/event-stream": { schema: { type: "string" } } } },
				400: { description: "The conversation identifier or replay cursor is malformed.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				401: { description: "No authenticated browser session owns the request.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				503: { description: "Canonical history could not be read.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
			},
		},
	},
};

/** Shared participant conversation response schema kept local to the owning OpenAPI fragment. */
const _ConversationSchema = {
	type: "object",
	required: ["id", "mode", "lifecycle", "agentServiceId", "participantUserIds", "archivedAt", "readThroughPosition", "updatedAt"],
	properties: {
		id: { type: "string" },
		mode: { type: "string", enum: ["agent_session", "direct", "group"] },
		lifecycle: { type: "string", enum: ["open", "closed"] },
		agentServiceId: { type: ["string", "null"] },
		participantUserIds: { type: "array", items: { type: "string" } },
		archivedAt: { type: ["string", "null"], format: "date-time" },
		readThroughPosition: { type: "string", pattern: "^(0|[1-9][0-9]*)$" },
		updatedAt: { type: "string", format: "date-time" },
	},
} as const;

/** OpenAPI path fragment for participant-owned immutable-mode conversation operations. */
export const _SelfConversationsOpenapiPaths = {
	"/me/conversations": {
		get: {
			operationId: "listMyConversations",
			summary: "List the signed-in participant's conversations",
			tags: ["Conversations"],
			parameters: [{ name: "includeArchived", in: "query", required: false, schema: { type: "boolean", default: false } }],
			responses: { 200: { description: "Participant-bound conversation summaries.", content: { "application/json": { schema: { type: "object", required: ["conversations"], properties: { conversations: { type: "array", items: _ConversationSchema } } } } } }, 401: { description: "Authentication required." }, 503: { description: "Conversation authority unavailable." } },
		},
		post: {
			operationId: "createMyConversation",
			summary: "Create one immutable-mode conversation",
			tags: ["Conversations"],
			requestBody: { required: true, content: { "application/json": { schema: { oneOf: [
				{ type: "object", additionalProperties: false, required: ["mode", "agentServiceId"], properties: { mode: { type: "string", enum: ["agent_session"] }, agentServiceId: { type: "string" } } },
				{ type: "object", additionalProperties: false, required: ["mode", "participantUserIds"], properties: { mode: { type: "string", enum: ["direct"] }, participantUserIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 1 } } },
				{ type: "object", additionalProperties: false, required: ["mode", "participantUserIds"], properties: { mode: { type: "string", enum: ["group"] }, participantUserIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 99 } } },
			] } } } },
			responses: { 201: { description: "Conversation created.", content: { "application/json": { schema: { type: "object", required: ["conversation"], properties: { conversation: _ConversationSchema } } } } }, 400: { description: "Invalid immutable-mode request." }, 401: { description: "Authentication required." }, 404: { description: "A participant or agent service is unavailable." }, 503: { description: "Conversation authority unavailable." } },
		},
	},
	"/me/conversations/{conversationId}": {
		get: {
			operationId: "openMyConversation",
			summary: "Open one participant-bound conversation",
			tags: ["Conversations"],
			parameters: [{ name: "conversationId", in: "path", required: true, schema: { type: "string" } }],
			responses: { 200: { description: "Conversation detail with bounded canonical message history." }, 401: { description: "Authentication required." }, 404: { description: "Conversation unavailable." }, 503: { description: "Conversation authority unavailable." } },
		},
	},
	"/me/conversations/{conversationId}/messages": {
		post: {
			operationId: "submitMyConversationMessage",
			summary: "Submit participant input through the immutable mode strategy",
			description: "Agent-session input is committed atomically with a governed run. Direct and ordinary group input is committed without creating an AgentRun.",
			tags: ["Conversations"],
			parameters: [{ name: "conversationId", in: "path", required: true, schema: { type: "string" } }],
			requestBody: {
				required: true,
				content: {
					"application/json": {
						schema: {
							type: "object",
							additionalProperties: false,
							required: ["idempotencyKey", "blocks"],
							properties: {
								idempotencyKey: { type: "string", maxLength: 128 },
								blocks: {
									type: "array",
									minItems: 1,
									maxItems: 32,
									items: {
										type: "object",
										additionalProperties: false,
										required: ["id", "kind", "value"],
										properties: { id: { type: "string" }, kind: { type: "string", enum: ["text", "artifact"] }, value: { type: "string", maxLength: 32000 } },
									},
								},
							},
						},
					},
				},
			},
			responses: { 201: { description: "Message accepted." }, 200: { description: "Exact idempotent retry returned the canonical message." }, 400: { description: "Invalid message body." }, 401: { description: "Authentication required." }, 404: { description: "Conversation unavailable." }, 409: { description: "Closed, active-run, mode, or idempotency conflict." }, 503: { description: "Admission authority unavailable." } },
		},
	},
	"/me/conversations/{conversationId}/archive": {
		patch: {
			operationId: "archiveMyConversation",
			summary: "Change participant-local archive visibility",
			tags: ["Conversations"],
			parameters: [{ name: "conversationId", in: "path", required: true, schema: { type: "string" } }],
			requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["archived"], properties: { archived: { type: "boolean" } } } } } },
			responses: { 200: { description: "Participant archive visibility changed." }, 400: { description: "Invalid archive request." }, 401: { description: "Authentication required." }, 404: { description: "Conversation unavailable." }, 503: { description: "Conversation authority unavailable." } },
		},
	},
	"/me/conversations/{conversationId}/close": {
		post: {
			operationId: "closeMyConversation",
			summary: "Permanently close one conversation",
			tags: ["Conversations"],
			parameters: [{ name: "conversationId", in: "path", required: true, schema: { type: "string" } }],
			responses: { 200: { description: "Conversation permanently closed." }, 401: { description: "Authentication required." }, 404: { description: "Conversation unavailable." }, 409: { description: "An active foreground run prevents closure." }, 503: { description: "Conversation authority unavailable." } },
		},
	},
} as const;
