/** Describes the reviewed company assistant setup result without exposing internal execution coordinates. */
const _ResultSchema = { type: "object", additionalProperties: false, required: ["created", "assistant"], properties: { created: { type: "boolean" }, assistant: { type: "object", additionalProperties: false, required: ["agentServiceId", "displayName"], properties: { agentServiceId: { type: "string" }, displayName: { type: "string" } } } } } as const;

/** Returns one authoritative active revision and its exact immutable tool selection. */
const _ToolsSchema = { type: "object", additionalProperties: false, required: ["agentServiceId", "activeRevisionId", "toolRevisionIds"], properties: { agentServiceId: { type: "string" }, activeRevisionId: { type: "string" }, toolRevisionIds: { type: "array", uniqueItems: true, items: { type: "string" } } } } as const;

/** Public operator setup paths composed into the application OpenAPI registry. */
export const _CompanyAssistantOpenapiPaths = {
	"/organization/company-assistant/tools": {
		get: {
			operationId: "getCompanyAssistantTools", summary: "Read the company assistant's current tool selection", tags: ["Organization assistants"],
			description: "Requires current Organization Administer. Returns the exact active immutable revision and sorted tool revision IDs. This read does not record effect admission or supply external credentials.",
			responses: { 200: { description: "Current selection.", content: { "application/json": { schema: _ToolsSchema } } }, 401: { description: "Authentication required." }, 403: { description: "Current administrator permission denied." }, 404: { description: "Active published company assistant unavailable." }, 503: { description: "Selection dependency unavailable." } },
		},
		put: {
			operationId: "setCompanyAssistantTools", summary: "Replace the company assistant's tool selection", tags: ["Organization assistants"],
			description: "Requires current Organization Administer and Assign on every selected same-silo ready tool revision of an active published server. Publishes an immutable successor and reconciles only the company's own Use/Invoke grants for removed and selected tools. A current unchanged selection is a no-op after fresh authorization. A stale expected revision always returns 409, including a retry after an uncertain successful commit; GET the authoritative selection before editing again. Empty selection removes all tools. This API creates no install or external credential binding and cannot borrow human private credentials.",
			requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["expectedActiveRevisionId", "toolRevisionIds"], properties: { expectedActiveRevisionId: { type: "string", minLength: 1, maxLength: 200, pattern: "^\\S(?:.*\\S)?$" }, toolRevisionIds: { type: "array", maxItems: 32, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 200, pattern: "^\\S(?:.*\\S)?$" } } } } } } },
			responses: { 200: { description: "Committed successor or unchanged current selection.", content: { "application/json": { schema: _ToolsSchema } } }, 400: { description: "Invalid tool selection." }, 401: { description: "Authentication required." }, 403: { description: "Current assignment permission or selected tool unavailable." }, 404: { description: "Active published company assistant unavailable." }, 409: { description: "Active revision changed; read current selection before another edit." }, 503: { description: "Assignment dependency unavailable; a failed response may follow a commit, so read current selection." } },
		},
	},
	"/organization/company-assistant": { post: {
		operationId: "provisionCompanyAssistant", summary: "Provision the company's first shared assistant", tags: ["Organization assistants"],
		description: "Requires current Organization Administer and selected Model Use. Select current human Principal IDs explicitly. Once a company assistant exists, this call returns created:false and leaves its name, policy, grants and lifecycle unchanged. Retrying can finish identity establishment after a committed setup; it cannot revive a suspended or revoked identity.",
		requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["name", "modelDefinitionId", "invokerPrincipalIds"], properties: { name: { type: "string", minLength: 1, maxLength: 120, pattern: "^\\S(?:.*\\S)?$" }, modelDefinitionId: { type: "string", minLength: 1, maxLength: 200, pattern: "^\\S(?:.*\\S)?$" }, invokerPrincipalIds: { type: "array", minItems: 1, maxItems: 100, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 200, pattern: "^\\S(?:.*\\S)?$" } } } } } } },
		responses: { 201: { description: "Company assistant created and identity established.", content: { "application/json": { schema: _ResultSchema } } }, 200: { description: "Existing company assistant returned; replacement choices were not applied.", content: { "application/json": { schema: _ResultSchema } } }, 400: { description: "Invalid setup choices." }, 401: { description: "Authentication required." }, 403: { description: "Setup authority or selected member unavailable." }, 503: { description: "Setup dependency unavailable; the same request may be retried." } },
	} },
} as const;
