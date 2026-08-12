import { API_ERROR_LIMITS, ApiValidationIssueLocations } from "@opencrane/contracts";

/**
 * One field-level validation problem, shaped so a client can attach it to the right input.
 *
 * `path` is the field path in segments, so a form can look up the control directly instead of
 * parsing a sentence. Every string is length-capped from `API_ERROR_LIMITS`, and the message is
 * required never to quote the value that was rejected — that rule is what makes it safe to show
 * a validation error verbatim in a UI.
 *
 * Registered as the `ValidationIssue` component by spec.ts and referenced from
 * {@link _ErrorEnvelopeSchema}. Changing it changes the generated client.
 */
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

/**
 * The body every error response in this API uses. Registered as the `Error` component by
 * spec.ts, and every documented 4xx/5xx across all domains references it, so a client can write
 * one error handler.
 *
 * `error` is for people and `code` is for programs — branch on `code` only, since `error` text
 * may be reworded. `issues` appears only for request-validation failures on public endpoints,
 * so treat it as absent everywhere else rather than relying on an empty array.
 *
 * @see {@link _ValidationIssueSchema} for what `issues` contains.
 */
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
