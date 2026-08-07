/** OpenAPI path fragment for starting one session-owned personal conversation run. */
export const _PersonalRunAdmissionOpenapiPaths = {
	"/me/runs": {
		post: {
			operationId: "startMyRun",
			summary: "Start a signed-in user's personal run from an existing conversation",
			description: "The body may name only a thread and idempotency key. The server derives the session subject, host silo, personal AgentService, signed personal membership assertion, organization, scope, dataset, and immutable run input snapshot.",
			tags: ["Runs"],
			requestBody: {
				required: true,
				content: {
					"application/json": {
						schema: {
							type: "object",
							additionalProperties: false,
							required: ["threadId", "requestIdempotencyKey"],
							properties: {
								threadId: { type: "string", description: "Existing conversation thread the signed-in user participates in." },
								requestIdempotencyKey: { type: "string", description: "Caller-generated key for safe transport retries." },
							},
						},
					},
				},
			},
			responses: {
				201: { description: "A new immutable run snapshot was accepted.", content: { "application/json": { schema: { type: "object", required: ["runId"], properties: { runId: { type: "string" } } } } } },
				200: { description: "A duplicate idempotency key returned the already-admitted run.", content: { "application/json": { schema: { type: "object", required: ["runId"], properties: { runId: { type: "string" } } } } } },
				400: { description: "The body omitted a required field or attempted to supply server-owned coordinates.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				401: { description: "No browser session owns the request.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				403: { description: "The thread, current personal persona, membership, dataset, or other admission evidence was unavailable.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				429: { description: "The shared managed-and-personal admission capacity is full.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				503: { description: "The run admission authority was unavailable.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
			},
		},
	},
};
