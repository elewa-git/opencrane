/**
 * Describes session introspection, the OIDC-only callback, and logout for the selected browser authentication mode.
 *
 * These paths share the browser-session contract. They remain separate from login and step-up
 * redirects so changes to the returned identity projection do not grow the root composition file.
 *
 * Called by: `spec` in `spec.ts` while composing the complete OpenAPI document.
 */
export const _AuthSessionOpenapiPaths = {
	"/auth/me": {
		get: {
			operationId: "getAuthStatus",
			summary: "Return current auth mode and authenticated user identity (if any)",
			description: "No authentication required. Returns 200 with the current session or an anonymous identity when no session is established.",
			tags: ["Auth"],
			security: [],
			responses: {
				200: {
					description: "Auth status.",
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["mode", "authenticated"],
								properties: {
									mode: { type: "string", enum: ["development", "oidc"], description: "Active authentication mode for this instance." },
									authenticated: { type: "boolean" },
									user: {
										type: "object",
										nullable: true,
										required: ["sub", "issuer", "groups", "isPlatformOperator", "productCapabilities"],
										properties: {
											sub: { type: "string" },
											issuer: { type: "string", description: "Configured authority that authenticated the user." },
											groups: { type: "array", items: { type: "string" }, description: "Stable group identifiers from the verified authority, or an empty set for Tier 3." },
											isPlatformOperator: {
												type: "boolean",
												description: "True when the authenticated middleware admitted a platform-operator claim. Introspection only; the API remains the enforcement point.",
											},
											productCapabilities: {
												type: "object",
												required: ["administerOrganization"],
												description: "Current product capabilities read from the central authorization authority. These guide the UI; protected routes repeat authorization in their own transaction.",
												properties: {
													administerOrganization: { type: "boolean", description: "Whether the local Principal currently holds organization:administer for this silo." },
												},
											},
											clusterTenant: {
												type: ["string", "null"],
												description: "The caller's admitted silo identifier, or null when the session has no silo projection.",
											},
											ownedOrgs: {
												type: "array",
												description: "Organisation administration projections resolved by the server. Empty when none are active.",
												items: {
													type: "object",
													required: ["clusterTenant", "role"],
													properties: {
														clusterTenant: { type: "string", description: "The organisation silo identifier." },
														role: { type: "string", enum: ["owner", "admin"], description: "The administering role the caller holds." },
													},
												},
											},
											email: { type: "string" },
											emailVerified: { type: "boolean" },
											name: { type: "string" },
											picture: { type: "string" },
											authenticatedAt: { type: "string", format: "date-time" },
										},
									},
								},
							},
						},
					},
				},
			},
		},
	},
	"/auth/callback": {
		get: {
			operationId: "completeOidcLogin",
			summary: "OIDC authorization callback — validates the response and establishes a session",
			description: "Called by the identity provider after a successful OIDC login. Tier 3 has no callback and returns 503.",
			tags: ["Auth"],
			security: [],
			parameters: [
				{ name: "code", in: "query", schema: { type: "string" } },
				{ name: "state", in: "query", schema: { type: "string" } },
			],
			responses: {
				302: { description: "Redirect back into the application." },
				503: { description: "OIDC not configured.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
			},
		},
	},
	"/auth/logout": {
		post: {
			operationId: "logout",
			summary: "Destroy the current session and return any upstream logout URL",
			description: "Invalidates the server-side session. OIDC may return an identity-provider logout URL; Tier 3 returns null.",
			tags: ["Auth"],
			security: [],
			responses: {
				200: {
					description: "Session destroyed; optional IdP logout URL returned.",
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["endSessionUrl"],
								properties: {
									endSessionUrl: {
										type: "string",
										nullable: true,
										description: "Absolute upstream logout URL, or null when upstream logout is unavailable.",
									},
								},
							},
						},
					},
				},
			},
		},
	},
} as const;
