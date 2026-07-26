/** OpenAPI path fragment for the browser-safe silo-scoped skill catalogue. */
export const _SkillCatalogueOpenapiPaths = {
	"/skills": {
		get: {
			operationId: "listSkills",
			summary: "List governed skills in the signed-in caller's silo",
			description: "The server derives the silo from the browser session and request host. It returns at most two hundred catalogue summaries, never skill bundles, artifact addresses, manifests, review evidence, signatures, or workload coordinates.",
			tags: ["Skills"],
			responses: {
				200: {
					description: "Browser-safe governed skill catalogue.",
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["skills"],
								properties: {
									skills: {
										type: "array",
										items: {
											type: "object",
											required: ["id", "name", "description", "state", "currentRevisionId", "currentRevisionState", "createdAt", "updatedAt"],
											properties: {
												id: { type: "string" },
												name: { type: "string" },
												description: { type: "string" },
												state: { type: "string", enum: ["active", "retired"] },
												currentRevisionId: { type: ["string", "null"] },
												currentRevisionState: { type: ["string", "null"], enum: ["draft", "review", "published", "rejected", "revoked", null] },
												createdAt: { type: "string", format: "date-time" },
												updatedAt: { type: "string", format: "date-time" },
											},
										},
									},
								},
							},
						},
					},
				},
				401: { description: "No authenticated browser session owns the request.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				503: { description: "The skill catalogue could not be read.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
			},
		},
	},
};
