/** Build one successful JSON response schema entry. */
function _Json(description: string, schema: object)
{
	return { description, content: { "application/json": { schema } } };
}

/** Build one standard error-envelope response schema entry. */
function _Error(description: string)
{
	return { description, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
}

/** OpenAPI paths owned by the personal future-session configuration domain. */
export const _PersonalConfigurationOpenapiPaths = {
	"/personal-configuration-changes/{changeId}/decision": {
		post: {
			operationId: "decidePersonalConfigurationChange",
			summary: "Accept or reject the caller's future-session configuration proposal",
			tags: ["Personal configuration"],
			parameters: [{ name: "changeId", in: "path", required: true, schema: { type: "string" } }],
			requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/PersonalConfigurationDecisionInput" } } } },
			responses: {
				200: _Json("Owner decision recorded; the accepted change still applies only during later snapshot materialisation.", { type: "object", required: ["decision"], properties: { decision: { type: "string", enum: ["accepted", "rejected"] } } }),
				400: _Error("Invalid exact decision input."),
				401: _Error("No active membership for the host silo."),
				404: _Error("Change unavailable or not owned by the caller."),
				409: _Error("Change has already been decided."),
				503: _Error("Membership or configuration authority unavailable."),
			},
		},
	},
};
