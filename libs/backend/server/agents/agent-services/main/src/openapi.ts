/** Describes the reviewed company assistant setup result without exposing internal execution coordinates. */
const _ResultSchema = { type: "object", additionalProperties: false, required: ["created", "assistant"], properties: { created: { type: "boolean" }, assistant: { type: "object", additionalProperties: false, required: ["agentServiceId", "displayName"], properties: { agentServiceId: { type: "string" }, displayName: { type: "string" } } } } } as const;

/** Public operator setup paths composed into the application OpenAPI registry. */
export const _CompanyAssistantOpenapiPaths = {
	"/organization/company-assistant": { post: {
		operationId: "provisionCompanyAssistant", summary: "Provision the company's first shared assistant", tags: ["Organization assistants"],
		description: "Requires current Organization Administer and selected Model Use. Select current human Principal IDs explicitly. Once a company assistant exists, this call returns created:false and leaves its name, policy, grants and lifecycle unchanged. Retrying can finish identity establishment after a committed setup; it cannot revive a suspended or revoked identity.",
		requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["name", "modelDefinitionId", "invokerPrincipalIds"], properties: { name: { type: "string", minLength: 1, maxLength: 120, pattern: "^\\S(?:.*\\S)?$" }, modelDefinitionId: { type: "string", minLength: 1, maxLength: 200, pattern: "^\\S(?:.*\\S)?$" }, invokerPrincipalIds: { type: "array", minItems: 1, maxItems: 100, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 200, pattern: "^\\S(?:.*\\S)?$" } } } } } } },
		responses: { 201: { description: "Company assistant created and identity established.", content: { "application/json": { schema: _ResultSchema } } }, 200: { description: "Existing company assistant returned; replacement choices were not applied.", content: { "application/json": { schema: _ResultSchema } } }, 400: { description: "Invalid setup choices." }, 401: { description: "Authentication required." }, 403: { description: "Setup authority or selected member unavailable." }, 503: { description: "Setup dependency unavailable; the same request may be retried." } },
	} },
} as const;
