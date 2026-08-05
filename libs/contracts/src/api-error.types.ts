import type { components } from "./generated/api.js";

/** Shared public-error bounds consumed by the server projector, OpenAPI, and browser parser. */
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
 * Stable request locations used by public field-validation issues.
 *
 * These values cross the HTTP boundary and let clients distinguish form fields from route and
 * query coordinates without parsing a dotted string.
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
