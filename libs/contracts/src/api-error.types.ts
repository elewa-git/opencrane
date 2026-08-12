import type { components } from "./generated/api.js";

/** The size caps on a public error body. All three of the server error projector, the OpenAPI schema, and the browser parser read these, so changing one number changes every side at once. */
export const API_ERROR_LIMITS = {
	/** Maximum public error-message length. */
	ErrorMessageLength: 500,
	/** Maximum stable error-code length. */
	CodeLength: 100,
	/** Maximum development-only detail length accepted by a client. */
	DetailLength: 2_000,
	/** Maximum field issues returned for one request. */
	IssueCount: 20,
	/** Maximum path depth returned for one field issue. */
	IssuePathSegments: 16,
	/** Maximum string path-segment length. */
	IssuePathSegmentLength: 120,
	/** Maximum public field-message length. */
	IssueMessageLength: 240,
} as const;

/**
 * Which part of a request a validation issue refers to.
 *
 * A client reads this instead of parsing a dotted path string, so it can map an issue onto the
 * right form field. Only `Body` exists today; a client must therefore tolerate an unknown value
 * rather than assuming the set is closed.
 */
export enum ApiValidationIssueLocations
{
	/** The issue belongs to the submitted JSON request body. */
	Body = "body",
}

/** Public error envelope generated from OpenCrane's OpenAPI contract. */
export type ApiErrorEnvelope = components["schemas"]["Error"];

/** One form-mappable issue carried by a public validation error. */
export type ApiValidationIssue = NonNullable<ApiErrorEnvelope["issues"]>[number];
