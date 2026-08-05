import { z, type ZodIssue } from "zod";
import type { RequestHandler } from "express";

import { API_ERROR_LIMITS, ApiValidationIssueLocations, type ApiValidationIssue } from "@opencrane/contracts";

import type { ValidatedPublicBodyHandler } from "./request-validation.types.js";

/** Dedicated safe-to-expose failure produced only by the public request-body wrapper. */
export class _RequestValidationProblem extends Error
{
	/** Bounded issues that may cross the public HTTP boundary. */
	public readonly issues: readonly ApiValidationIssue[];

	/** Construct one fixed public validation failure from already-sanitized issues. */
	public constructor(issues: readonly ApiValidationIssue[])
	{
		super("Request validation failed");
		this.name = "RequestValidationProblem";
		this.issues = issues;
	}
}

/** Bound one schema-authored public message without exposing the rejected value. */
function _BoundMessage(value: string): string
{
	return value.slice(0, API_ERROR_LIMITS.IssueMessageLength);
}

/** Project a path segment without retaining oversized caller-controlled property names. */
function _PublicPathSegment(segment: string | number): string | number
{
	return typeof segment === "string" ? segment.slice(0, API_ERROR_LIMITS.IssuePathSegmentLength) : segment;
}

/** Map Zod's internal categories onto stable messages that never echo a rejected value. */
function _PublicMessage(issue: ZodIssue): string
{
	switch (issue.code)
	{
		case z.ZodIssueCode.invalid_type:
			return issue.received === "undefined" ? "This field is required." : "This field has an invalid type.";
		case z.ZodIssueCode.invalid_literal:
		case z.ZodIssueCode.invalid_enum_value:
		case z.ZodIssueCode.invalid_union_discriminator:
			return "This field has an unsupported value.";
		case z.ZodIssueCode.too_small:
			return "This field is below the allowed minimum.";
		case z.ZodIssueCode.too_big:
			return "This field exceeds the allowed maximum.";
		case z.ZodIssueCode.invalid_string:
			return "This field has an invalid format.";
		case z.ZodIssueCode.unrecognized_keys:
			return "The request contains unrecognized fields.";
		case z.ZodIssueCode.custom:
		{
			const publicMessage = issue.params?.["publicMessage"];
			return typeof publicMessage === "string" ? _BoundMessage(publicMessage) : "This field is invalid.";
		}
		default:
			return "This field is invalid.";
	}
}

/** Convert one Zod issue into the bounded public response contract. */
function _PublicIssue(issue: ZodIssue): ApiValidationIssue
{
	const issuePath = issue.code === z.ZodIssueCode.unrecognized_keys && issue.keys.length > 0
		? [...issue.path, issue.keys[0]]
		: issue.path;
	return {
		location: ApiValidationIssueLocations.Body,
		path: issuePath.slice(0, API_ERROR_LIMITS.IssuePathSegments).map(_PublicPathSegment),
		message: _PublicMessage(issue),
	};
}

/** Keep a bounded prefix of safe public issues so malformed input cannot amplify a response. */
function _PublicIssues(issues: readonly ZodIssue[]): ApiValidationIssue[]
{
	return issues.slice(0, API_ERROR_LIMITS.IssueCount).map(_PublicIssue);
}

/**
 * Wrap one authenticated public route handler with model-adjacent Zod body validation.
 *
 * Mount authorization middleware before this handler whenever field diagnostics could disclose a
 * protected contract. Internal workload routes must keep their opaque, identity-first validation.
 */
export function ___WithValidatedPublicBody<T>(schema: z.ZodType<T>, handler: ValidatedPublicBodyHandler<T>): RequestHandler
{
	return async function _validatedPublicBody(request, response, next): Promise<void>
	{
		// 1. Parse through the owning model schema so HTTP never acquires a duplicate field list.
		const parsed = schema.safeParse(request.body);

		// 2. Emit only the bounded public projection; raw Zod errors and rejected values stay internal.
		if (!parsed.success)
		{
			next(new _RequestValidationProblem(_PublicIssues(parsed.error.issues)));
			return;
		}

		// 3. Give the route the validated model directly so it never casts the untrusted request body.
		await handler(request, response, next, parsed.data);
	};
}
