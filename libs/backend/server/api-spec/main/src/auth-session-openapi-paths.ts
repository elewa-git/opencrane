/**
 * Describes session introspection, OIDC callback completion, and logout.
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
										required: ["sub", "issuer", "groups", "isPlatformOperator", "isOrgAdmin"],
										properties: {
											sub: { type: "string" },
											issuer: { type: "string", description: "Identity provider that authenticated the user." },
											groups: { type: "array", items: { type: "string" }, description: "The caller's stable group identifiers from the OIDC groups claim (empty when none)." },
											isPlatformOperator: {
												type: "boolean",
												description: "True when the authenticated middleware admitted a platform-operator claim. Introspection only; the API remains the enforcement point.",
											},
											isOrgAdmin: {
												type: "boolean",
												description: "True when the authenticated middleware admitted organisation administration authority. Introspection only; the API remains the enforcement point.",
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
			description: "Called by the identity provider after a successful login. Redirects back to the SPA.",
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
			summary: "Destroy the current session and return the IdP RP-initiated logout URL",
			description: "Invalidates the server-side session and returns the identity provider logout URL when upstream logout is available.",
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
