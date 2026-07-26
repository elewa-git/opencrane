/** OpenAPI path fragment for owner-only deferred tool approvals. */
export const _AuthorizationOpenapiPaths = {
	"/me/approvals/{approvalRequestId}/decision": {
		post: {
			operationId: "decideDeferredToolApproval",
			summary: "Approve or deny one pending tool action owned by the signed-in user",
			description: "The server derives the owner and silo from the browser session. The body can contain only the terminal decision; it cannot choose another run, subject, tool result, or resume credential.",
			tags: ["Approvals"],
			parameters: [{ name: "approvalRequestId", in: "path", required: true, schema: { type: "string" }, description: "Opaque identifier for the pending approval." }],
			requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["decision"], additionalProperties: false, properties: { decision: { type: "string", enum: ["approved", "denied"] } } } } } },
			responses: {
				200: { description: "Decision recorded or identical terminal decision replayed.", content: { "application/json": { schema: { type: "object", required: ["approvalRequestId", "state"], properties: { approvalRequestId: { type: "string" }, state: { type: "string", enum: ["approved", "denied"] } } } } } },
				400: { description: "The request body is not the exact decision shape.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				401: { description: "No authenticated browser session owns the request.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				404: { description: "The approval is absent, terminal in another way, or not owned by the caller.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				409: { description: "The approval expired before the decision.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				503: { description: "The product authority could not persist the decision.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
			},
		},
	},
};
