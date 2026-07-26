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
};
