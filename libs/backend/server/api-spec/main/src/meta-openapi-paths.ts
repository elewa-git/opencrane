/**
 * Describes the public endpoint that serves the composed OpenAPI document.
 *
 * Called by: `spec` in `spec.ts` after all domain and authentication paths are composed.
 */
export const _MetaOpenapiPaths = {
	"/openapi.json": {
		get: {
			operationId: "getOpenApiSpec",
			summary: "Retrieve the OpenAPI 3.1 specification for this API",
			tags: ["Meta"],
			security: [],
			responses: {
				200: {
					description: "OpenAPI 3.1 document.",
					content: { "application/json": { schema: { type: "object" } } },
				},
			},
		},
	},
} as const;
