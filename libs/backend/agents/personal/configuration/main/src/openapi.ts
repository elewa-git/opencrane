/** OpenAPI path fragment for the signed-in owner's personal configuration proposal state. */
export const _PersonalConfigurationOpenapiPaths = {
	"/me/configuration/changes/{changeId}/decision": {
		post: {
			operationId: "decideMyPersonalConfigurationChange",
			summary: "Accept or reject one signed-in owner's configuration proposal",
			description: "The server derives the owner, silo, and decision time. A decision records consent only; it never applies a patch to an existing run snapshot.",
			tags: ["Personal configuration"],
			parameters: [{ name: "changeId", in: "path", required: true, schema: { type: "string" } }],
			requestBody: { required: true, content: { "application/json": { schema: { oneOf: [{ type: "object", required: ["decision"], additionalProperties: false, properties: { decision: { const: "accepted" } } }, { type: "object", required: ["decision", "rejectionReason"], additionalProperties: false, properties: { decision: { const: "rejected" }, rejectionReason: { type: "string", minLength: 1, maxLength: 200, pattern: ".*\\S.*" } } }] } } } },
			responses: {
				200: { description: "Owner decision recorded.", content: { "application/json": { schema: { type: "object", required: ["changeId", "state"], properties: { changeId: { type: "string" }, state: { type: "string", enum: ["accepted", "rejected"] } } } } } },
				400: { description: "Decision body is not the exact accepted or rejected shape.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				401: { description: "No browser session owns the request.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				404: { description: "Proposal is absent, terminal, or not owned by the caller.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				503: { description: "Decision could not be persisted.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
			},
		},
	},
	"/me/configuration/changes": {
		get: {
			operationId: "listMyPersonalConfigurationChanges",
			summary: "List the signed-in owner's personal configuration proposals",
			description: "The server derives the owner and silo from session and host. It returns at most fifty durable future-session proposals, never a mutable run snapshot.",
			tags: ["Personal configuration"],
			responses: {
				200: { description: "Owner-bound configuration proposal history.", content: { "application/json": { schema: { type: "object", required: ["changes"], properties: { changes: { type: "array", items: { $ref: "#/components/schemas/PersonalConfigurationChange" } } } } } } },
				401: { description: "No browser session owns the request.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				503: { description: "Configuration proposal history could not be read.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
			},
		},
	},
};
