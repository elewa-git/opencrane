import { API_ERROR_LIMITS, ApiValidationIssueLocations } from "@opencrane/contracts";

/** Bounded request-field diagnostic safe for a public client to map onto a form control. */
export const _ValidationIssueSchema = {
	type: "object" as const,
	additionalProperties: false,
	required: ["location", "path", "message"],
	properties: {
		location: { type: "string", enum: Object.values(ApiValidationIssueLocations), description: "Request coordinate that contains the invalid field." },
		path: { type: "array", maxItems: API_ERROR_LIMITS.IssuePathSegments, items: { oneOf: [{ type: "string", maxLength: API_ERROR_LIMITS.IssuePathSegmentLength }, { type: "integer" }] }, description: "Field path segments suitable for direct form-control mapping." },
		message: { type: "string", maxLength: API_ERROR_LIMITS.IssueMessageLength, description: "Safe validation message that never includes the rejected value." },
	},
};

/** Standard public error envelope shared by every documented error response. */
export const _ErrorEnvelopeSchema = {
	type: "object" as const,
	required: ["error", "code"],
	properties: {
		error: { type: "string", maxLength: API_ERROR_LIMITS.ErrorMessageLength, description: "Human-readable error description." },
		code: { type: "string", maxLength: API_ERROR_LIMITS.CodeLength, description: "Machine-readable error code." },
		detail: { type: "string", maxLength: API_ERROR_LIMITS.DetailLength, description: "Optional extra context." },
		issues: { type: "array", maxItems: API_ERROR_LIMITS.IssueCount, items: { $ref: "#/components/schemas/ValidationIssue" }, description: "Field diagnostics returned only for public request validation failures." },
	},
};
