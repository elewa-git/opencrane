/**
 * Describes public OIDC redirects whose query contracts are enforced by the identity router.
 *
 * Keeping these related paths together lets login and step-up evolve without growing the root
 * specification or duplicating their shared error envelope references.
 *
 * Called by: `spec` in `spec.ts` while composing the complete OpenAPI document.
 */
export const _AuthOpenapiPaths = {
	"/auth/login": {
		get: {
			operationId: "startOidcLogin",
			summary: "Redirect the browser to the configured OIDC identity provider to start login",
			description: "Browser redirect — not intended for programmatic use. Returns 503 when OIDC is not configured.",
			tags: ["Auth"],
			security: [],
			parameters: [
				{ name: "returnTo", in: "query", schema: { type: "string" }, description: "Path to redirect back to after a successful login." },
				{ name: "prompt", in: "query", schema: { type: "string", enum: ["create"] }, description: "Use create to open the identity provider's registration flow. Other values are rejected." },
			],
			responses: {
				302: { description: "Redirect to identity provider." },
				400: { description: "Unsupported login prompt.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				503: { description: "OIDC not configured.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
			},
		},
	},
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
