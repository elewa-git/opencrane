/**
 * Describes public browser-authentication redirects whose query contracts are enforced by the selected identity router.
 *
 * Keeping these related paths together lets login and step-up evolve without growing the root
 * specification or duplicating their shared error envelope references.
 *
 * Called by: `spec` in `spec.ts` while composing the complete OpenAPI document.
 */
export const _AuthOpenapiPaths = {
	"/auth/login": {
		get: {
			operationId: "startBrowserLogin",
			summary: "Start the browser login selected by this deployment",
			description: "Browser redirect — not intended for programmatic use. Production redirects to OIDC; Tier 3 establishes its installation-selected development identity.",
			tags: ["Auth"],
			security: [],
			parameters: [
				{ name: "returnTo", in: "query", schema: { type: "string" }, description: "Path to redirect back to after a successful login." },
				{ name: "prompt", in: "query", schema: { type: "string", enum: ["create"] }, description: "Use create to open the OIDC provider's registration flow. Tier 3 and other values reject the prompt." },
			],
			responses: {
				302: { description: "Redirect to the identity provider or back into Tier 3 with its signed development session." },
				400: { description: "Unsupported login prompt.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				403: { description: "Tier 3 proxy proof is absent or invalid.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				503: { description: "The selected browser authentication is unavailable.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
			},
		},
	},
	"/auth/reauthenticate": {
		get: {
			operationId: "reauthenticate",
				summary: "Refresh the selected browser authentication for a sensitive action",
			tags: ["Auth"],
			parameters: [{ name: "returnTo", in: "query", required: false, schema: { type: "string" }, description: "Local path restored after the verified callback." }],
			responses: {
				302: { description: "Redirect through fresh provider authentication or renew the bounded Tier 3 development session." },
				401: { description: "An authenticated session is required before step-up.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				403: { description: "Tier 3 proxy proof is absent or invalid.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				503: { description: "The selected browser authentication is unavailable." },
			},
		},
	},
} as const;
