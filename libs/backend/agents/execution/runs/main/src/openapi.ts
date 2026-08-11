/** OpenAPI path fragment for authenticated owner-visible run status. */
export const _SelfRunStatusOpenapiPaths = {
	"/me/runs": {
		get: {
			operationId: "listMyRuns",
			summary: "List a signed-in owner's fifty most recent personal runs",
			description: "The server derives the owner and silo from session and host, then returns at most fifty canonical lifecycle summaries ordered newest first.",
			tags: ["Runs"],
			responses: {
				200: { description: "Recent canonical lifecycle views for the owned runs.", content: { "application/json": { schema: { type: "object", required: ["runs"], properties: { runs: { type: "array", items: { $ref: "#/components/schemas/SelfRunStatus" } } } } } } },
				401: { description: "No browser session owns the request.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				503: { description: "Run status could not be read.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
			},
		},
	},
	"/me/runs/{runId}": {
		get: {
			operationId: "getMyRunStatus",
			summary: "Return one signed-in owner's personal run status",
			description: "The server derives the owner and silo from session and host. It never accepts owner coordinates from the request.",
			tags: ["Runs"],
			parameters: [{ name: "runId", in: "path", required: true, schema: { type: "string" }, description: "Opaque run identifier." }],
			responses: {
				200: { description: "Current canonical lifecycle view for the owned run.", content: { "application/json": { schema: { $ref: "#/components/schemas/SelfRunStatus" } } } },
				400: { description: "The run identifier is malformed.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				401: { description: "No browser session owns the request.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				404: { description: "The run is absent or not owned by the caller.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				503: { description: "Run status could not be read.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
			},
		},
	},
	"/me/runs/{runId}/cancellation": {
		post: {
			operationId: "cancelMyRun",
			summary: "Cancel the exact personal run attempt observed by its signed-in owner",
			description: "The server derives owner and silo from the browser session, rejects stale attempts, and never exposes whether a foreign run exists.",
			tags: ["Runs"],
			parameters: [{ name: "runId", in: "path", required: true, schema: { type: "string" }, description: "Opaque run identifier." }],
			requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["expectedAttempt"], properties: { expectedAttempt: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER, description: "Attempt last observed by the browser." } } } } } },
			responses: {
				200: { description: "The run was already, or is now, fully cancelled.", content: { "application/json": { schema: { $ref: "#/components/schemas/SelfRunCancellation" } } } },
				202: { description: "Cancellation is fenced while physical cleanup completes.", content: { "application/json": { schema: { $ref: "#/components/schemas/SelfRunCancellation" } } } },
				400: { description: "The identifier or request body is malformed.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				401: { description: "No browser session owns the request.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				403: { description: "The browser request failed CSRF protection.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				404: { description: "The run is absent or not owned by the caller.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				409: { description: "The attempt is stale, terminal, or could not be safely fenced.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				503: { description: "Cancellation authority is temporarily unavailable.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
			},
		},
	},
};
