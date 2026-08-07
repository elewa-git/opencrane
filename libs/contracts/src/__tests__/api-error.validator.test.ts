import { describe, expect, it } from "vitest";

import { ApiValidationIssueLocations, ___ParseApiErrorEnvelope } from "../index.js";

describe("public API error contract", function _Suite()
{
	it("accepts bounded form-mappable validation issues", function _AcceptIssues()
	{
		const parsed = ___ParseApiErrorEnvelope({
			error: "Request validation failed.",
			code: "VALIDATION_ERROR",
			issues: [{ location: ApiValidationIssueLocations.Body, path: ["autoConfig", "objective"], message: "This field has an unsupported value." }],
			ignored: "not part of the public model",
		});

		expect(parsed).toEqual({
			error: "Request validation failed.",
			code: "VALIDATION_ERROR",
			issues: [{ location: "body", path: ["autoConfig", "objective"], message: "This field has an unsupported value." }],
		});
	});

	it("rejects an unbounded issue path", function _RejectUnboundedPath()
	{
		const parsed = ___ParseApiErrorEnvelope({
			error: "Request validation failed.",
			code: "VALIDATION_ERROR",
			issues: [{ location: "body", path: Array.from({ length: 17 }, function _PathSegment(_value, index): number { return index; }), message: "Invalid." }],
		});

		expect(parsed).toBeNull();
	});
});
