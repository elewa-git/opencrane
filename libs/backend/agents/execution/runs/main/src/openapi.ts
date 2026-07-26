/** OpenAPI path fragment for authenticated owner-visible run status. */
export const _SelfRunStatusOpenapiPaths = {
	"/me/runs/{runId}": {
		get: {
			operationId: "getMyRunStatus",
			summary: "Return one signed-in owner's personal run status",
			description: "The server derives the owner and silo from session and host. It never accepts owner coordinates from the request.",
			tags: ["Runs"],
			parameters: [{ name: "runId", in: "path", required: true, schema: { type: "string" }, description: "Opaque run identifier." }],
			responses: {
				200: { description: "Current canonical lifecycle view for the owned run.", content: { "application/json": { schema: { type: "object", required: ["runId", "attempt", "state", "threadId", "agentRevisionId", "acceptedAt", "finishedAt"], properties: { runId: { type: "string" }, attempt: { type: "integer", minimum: 1 }, state: { type: "string", enum: ["accepted", "queued", "assigned", "running", "waiting_for_approval", "cancelling", "completed", "failed", "cancelled"] }, threadId: { type: "string", nullable: true }, agentRevisionId: { type: "string" }, acceptedAt: { type: "string", format: "date-time" }, finishedAt: { type: "string", format: "date-time", nullable: true } } } } } },
				400: { description: "The run identifier is malformed.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				401: { description: "No browser session owns the request.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				404: { description: "The run is absent or not owned by the caller.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				503: { description: "Run status could not be read.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
			},
		},
	},
};
