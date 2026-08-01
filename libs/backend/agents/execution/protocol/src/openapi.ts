/** OpenAPI path fragment for owner-only runtime steering ingestion. */
export const _RuntimeSteeringOpenapiPaths = {
	"/me/runs/{runId}/steering": {
		post: {
			operationId: "submitRuntimeSteering",
			summary: "Queue one signed-in owner's instruction for a running agent",
			description: "The server derives the owner, silo, and current attempt. The instruction is queued durably and is consumed only at the runtime's fenced safe boundary.",
			tags: ["Runs"],
			parameters: [{ name: "runId", in: "path", required: true, schema: { type: "string" }, description: "Opaque run identifier." }],
			requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["text"], additionalProperties: false, properties: { text: { type: "string", minLength: 1, maxLength: 4000 } } } } } },
			responses: {
				202: { description: "Steering request queued for the current run attempt.", content: { "application/json": { schema: { type: "object", required: ["steeringRequestId", "attempt", "state"], properties: { steeringRequestId: { type: "string" }, attempt: { type: "integer", minimum: 1 }, state: { type: "string", enum: ["pending"] } } } } } },
				400: { description: "The body is not one bounded text instruction.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				401: { description: "No authenticated browser session owns the request.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				404: { description: "The run is absent or not owned by the caller.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				409: { description: "The owned run has no steerable live attempt.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				503: { description: "The product authority could not persist the instruction.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
			},
		},
	},
};
