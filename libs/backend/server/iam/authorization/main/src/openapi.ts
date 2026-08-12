/** OpenAPI path fragment for owner-only deferred tool approvals. */
export const _AuthorizationOpenapiPaths = {
	"/me/approvals": {
		get: {
			operationId: "listMyPendingToolApprovals",
			summary: "List the signed-in owner's pending tool approvals",
			description: "The server derives the owner and silo from the browser session and host. It returns at most fifty actionable interrupts with pre-redacted proposed arguments and an exact decision response schema derived from the frozen reviewed tool schema. It never returns secret-marked values, raw authority evidence, policy digests, or resume material.",
			tags: ["Approvals"],
			responses: {
				200: { description: "Pending owner-bound tool approvals.", content: { "application/json": { schema: { type: "object", required: ["approvals"], properties: { approvals: { type: "array", items: { $ref: "#/components/schemas/SelfDeferredToolApproval" } } } } } } },
				401: { description: "No authenticated browser session owns the request.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				503: { description: "The product authority could not read pending approvals.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
			},
		},
	},
	"/me/approvals/{approvalRequestId}": {
		get: {
			operationId: "getMyToolApproval",
			summary: "Read one tool interrupt owned by the signed-in user",
			description: "The approval id is the interrupt id. The response reports actor-relevant state, pre-redacted proposed arguments, and the frozen decision response schema without returning server-only reviewed arguments or resume material.",
			tags: ["Approvals"],
			parameters: [{ name: "approvalRequestId", in: "path", required: true, schema: { type: "string" }, description: "Interrupt identifier for the owned approval." }],
			responses: {
				200: { description: "Owned tool interrupt.", content: { "application/json": { schema: { type: "object", required: ["approval"], properties: { approval: { $ref: "#/components/schemas/SelfDeferredToolApproval" } } } } } },
				400: { description: "The interrupt identifier is empty.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				401: { description: "No authenticated browser session owns the request.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				404: { description: "The interrupt is absent or belongs to another actor or silo.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				503: { description: "The product authority could not read the interrupt.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
			},
		},
	},
	"/me/approvals/{approvalRequestId}/decision": {
		post: {
			operationId: "decideDeferredToolApproval",
			summary: "Approve or deny one pending tool action owned by the signed-in user",
			description: "The server derives the owner and silo from the browser session. Approval must carry one complete argument value, which the server validates against the frozen reviewed response schema; denial carries no arguments. Partial edits, run coordinates, tool results, and resume material are rejected.",
			tags: ["Approvals"],
			parameters: [{ name: "approvalRequestId", in: "path", required: true, schema: { type: "string" }, description: "Opaque identifier for the pending approval." }],
			requestBody: { required: true, content: { "application/json": { schema: { oneOf: [{ type: "object", required: ["decision", "arguments"], additionalProperties: false, properties: { decision: { type: "string", const: "approved" }, arguments: {} } }, { type: "object", required: ["decision"], additionalProperties: false, properties: { decision: { type: "string", const: "denied" } } }] } } } },
			responses: {
				200: { description: "Decision recorded or identical terminal decision replayed.", content: { "application/json": { schema: { type: "object", required: ["approvalRequestId", "state"], properties: { approvalRequestId: { type: "string" }, state: { type: "string", enum: ["approved", "denied"] } } } } } },
				400: { description: "The request body is not the exact decision shape, or approved arguments fail the frozen reviewed schema.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				401: { description: "No authenticated browser session owns the request.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				404: { description: "The approval is absent, terminal in another way, or not owned by the caller.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				409: { description: "The approval expired before the decision.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				503: { description: "The product authority could not persist the decision.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
			},
		},
	},
};
