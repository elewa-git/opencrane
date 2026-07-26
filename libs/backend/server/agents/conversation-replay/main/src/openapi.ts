/** OpenAPI path fragment for owner-bound canonical conversation replay. */
export const _SelfConversationReplayOpenapiPaths = {
	"/me/conversations/{threadId}/events": {
		get: {
			operationId: "replayMyConversationEvents",
			summary: "Replay the signed-in participant's canonical conversation events",
			description: "The server derives the participant and silo from the browser session. It streams display-safe canonical events only when that participant belongs to the selected thread.",
			tags: ["Conversations"],
			parameters: [
				{ name: "threadId", in: "path", required: true, schema: { type: "string" }, description: "Opaque conversation-thread identifier." },
				{ name: "cursor", in: "query", required: false, schema: { type: "string" }, description: "Opaque canonical event cursor. The Last-Event-ID header is an equivalent resume mechanism." },
				{ name: "Last-Event-ID", in: "header", required: false, schema: { type: "string" }, description: "Opaque canonical event cursor. It must match cursor when both are supplied." },
			],
			responses: {
				200: { description: "A bounded text/event-stream replay. An empty stream does not disclose whether the thread exists or belongs to another participant.", content: { "text/event-stream": { schema: { type: "string" } } } },
				400: { description: "The thread identifier or replay cursor is malformed.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				401: { description: "No authenticated browser session owns the request.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				503: { description: "Canonical history could not be read.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
			},
		},
	},
};
