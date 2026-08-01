/** OpenAPI path fragments owned by the managed-agent catalogue and management authority. */
export const _AgentServicesOpenapiPaths = {
	"/agent-services": {
		get: {
			operationId: "listManagedAgentServices",
			summary: "List managed agent services in the signed-in caller's silo",
			description: "The server derives the silo from the browser session and request host. It returns at most two hundred managed-service summaries, ordered by most recently updated first.",
			tags: ["Agent services"],
			responses: {
				200: { description: "Managed agent services in the selected silo.", content: { "application/json": { schema: { type: "object", required: ["services"], properties: { services: { type: "array", items: { $ref: "#/components/schemas/AgentService" } } } } } } },
				401: { description: "No authenticated browser session owns the request.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				500: { description: "The management authority could not read the catalogue.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
			},
		},
	},
};
