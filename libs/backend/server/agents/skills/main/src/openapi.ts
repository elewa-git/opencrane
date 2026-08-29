import { SkillCatalogueRevisionStates, SkillCatalogueStates } from "./skill-catalogue.types";

/** OpenAPI paths for the browser-safe skill catalogue and validation start command. */
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
												state: { type: "string", enum: [SkillCatalogueStates.Active, SkillCatalogueStates.Retired] },
												currentRevisionId: { type: ["string", "null"] },
												currentRevisionState: { type: ["string", "null"], enum: [SkillCatalogueRevisionStates.Draft, SkillCatalogueRevisionStates.Review, SkillCatalogueRevisionStates.Published, SkillCatalogueRevisionStates.Rejected, SkillCatalogueRevisionStates.Revoked, null] },
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
	"/skills/authoring-validations": {
		post: {
			operationId: "startSkillAuthoringValidation",
			summary: "Start validation for a Draft Python skill revision",
			description: "A workflow is a saved task that can continue after a worker or server restarts. This route starts one workflow that tests and scans the selected Draft revision. The server reads the silo and artifact details itself; the request supplies only the revision identifier.",
			tags: ["Skills"],
			requestBody: {
				required: true,
				content: {
					"application/json": {
						schema: {
							type: "object",
							additionalProperties: false,
							required: ["skillRevisionId"],
							properties: { skillRevisionId: { type: "string", minLength: 1, maxLength: 256 } },
						},
					},
				},
			},
			responses: {
				202: {
					description: "The validation and its saved workflow task were committed together.",
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["validationId", "taskId"],
								properties: { validationId: { type: "string" }, taskId: { type: "string" } },
							},
						},
					},
				},
				400: { description: "The request did not contain one valid skill revision identifier.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				401: { description: "No authenticated browser session owns the request.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				403: { description: "The authenticated Principal does not own the selected skill revision.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				409: { description: "The selected revision cannot start this validation.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				503: { description: "The validation could not be saved.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
			},
		},
	},
};
