/** OpenAPI path fragment for the signed-in owner's personal configuration proposal state. */
export const _PersonalConfigurationOpenapiPaths = {
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
