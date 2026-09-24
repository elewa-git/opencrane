/** Exact current personal tool selection returned by both route methods. */
const _SelectionSchema = { type: "object", additionalProperties: false, required: ["agentServiceId", "activeRevisionId", "toolRevisionIds"], properties: { agentServiceId: { type: "string" }, activeRevisionId: { type: "string" }, toolRevisionIds: { type: "array", uniqueItems: true, items: { type: "string" } } } } as const;

/** Public personal-agent tool path composed into the application OpenAPI registry. */
export const _PersonalAgentToolsOpenapiPaths = {
	"/me/agent/tools": {
		get: {
			operationId: "getPersonalAgentTools", summary: "Read the personal agent's current tool selection", tags: ["Personal agent"],
			description: "Requires current Edit on the caller's unique active personal AgentService. Returns its immutable active revision and sorted tool revision IDs without recording effect admission or exposing credentials.",
			responses: { 200: { description: "Current selection.", content: { "application/json": { schema: _SelectionSchema } } }, 401: { description: "Authentication required." }, 403: { description: "Current personal-agent permission denied." }, 404: { description: "Unique active published personal agent unavailable." }, 503: { description: "Selection dependency unavailable." } },
		},
		put: {
			operationId: "setPersonalAgentTools", summary: "Replace the personal agent's tool selection", tags: ["Personal agent"],
			description: "Requires current AgentService Edit and Assign on every selected same-silo ready tool revision of an active published MCP server. Publishes an immutable successor while preserving its persona, model, skills, budget and boundaries, and reconciles only the owner's exact personal Use and Invoke grants. A stale expected revision returns 409, including a retry after an uncertain successful commit. Empty selection removes all tools.",
			requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["expectedActiveRevisionId", "toolRevisionIds"], properties: { expectedActiveRevisionId: { type: "string", minLength: 1, maxLength: 128, pattern: "^\\S(?:.*\\S)?$" }, toolRevisionIds: { type: "array", maxItems: 32, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 128, pattern: "^\\S(?:.*\\S)?$" } } } } } } },
			responses: { 200: { description: "Committed successor or authorized unchanged selection.", content: { "application/json": { schema: _SelectionSchema } } }, 400: { description: "Invalid tool selection." }, 401: { description: "Authentication required." }, 403: { description: "Current Edit, selected Assign, or selected tool availability denied." }, 404: { description: "Unique active published personal agent unavailable." }, 409: { description: "Active revision changed; read the current selection before another edit." }, 503: { description: "Assignment dependency unavailable; read current selection after an uncertain response." } },
		},
	},
} as const;
