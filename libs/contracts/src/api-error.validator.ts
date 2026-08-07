import { z } from "zod";

import { API_ERROR_LIMITS, ApiValidationIssueLocations, type ApiErrorEnvelope } from "./api-error.types.js";

/**
 * Runtime validation stays beside the generated public error model so browser transports never
 * trust an untyped failure body or maintain their own copy of the accepted envelope.
 */

/** One bounded field issue from the public HTTP error contract. */
const _ApiValidationIssueSchema = z.object({
	location: z.nativeEnum(ApiValidationIssueLocations),
	path: z.array(z.union([z.string().max(API_ERROR_LIMITS.IssuePathSegmentLength), z.number().int()])).max(API_ERROR_LIMITS.IssuePathSegments),
	message: z.string().min(1).max(API_ERROR_LIMITS.IssueMessageLength),
}).strip();

/** Public API error model consumed by browser transports. */
const _ApiErrorEnvelopeSchema: z.ZodType<ApiErrorEnvelope> = z.object({
	error: z.string().min(1).max(API_ERROR_LIMITS.ErrorMessageLength),
	code: z.string().min(1).max(API_ERROR_LIMITS.CodeLength),
	detail: z.string().max(API_ERROR_LIMITS.DetailLength).optional(),
	issues: z.array(_ApiValidationIssueSchema).max(API_ERROR_LIMITS.IssueCount).optional(),
}).strip();

/** Parse one public API error body without trusting an untyped or oversized response. */
export function ___ParseApiErrorEnvelope(value: unknown): ApiErrorEnvelope | null
{
	const parsed = _ApiErrorEnvelopeSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}
