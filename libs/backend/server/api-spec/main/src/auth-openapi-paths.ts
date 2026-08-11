/** Authentication path fragment that keeps the oversized root specification declarative. */
export const _AuthStepUpOpenapiPaths = {
	"/auth/reauthenticate": {
		get: {
			operationId: "reauthenticate",
			summary: "Force fresh OIDC authentication for a sensitive action",
			tags: ["Auth"],
			parameters: [{ name: "returnTo", in: "query", required: false, schema: { type: "string" }, description: "Local path restored after the verified callback." }],
			responses: {
				302: { description: "Redirect to the configured provider with prompt=login." },
				401: { description: "An authenticated session is required before step-up.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				503: { description: "OIDC is not configured." },
			},
		},
	},
} as const;
