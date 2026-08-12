import { describe, expect, it } from "vitest";
import type { JsonValue } from "@opencrane/util";

import { __IsDeferredToolApprovalReplacementAllowed, __ProjectDeferredToolApproval, __ValidateDeferredToolArguments } from "../deferred-tool-approval-schema.js";

/** Frozen reviewed schema used to prove secret-safe projection and full replacement validation. */
const SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["query", "token", "nested"],
	properties: {
		query: { type: "string", minLength: 1 },
		token: { type: "string", writeOnly: true, default: "secret-default", examples: ["secret-example"] },
		nested: { type: "object", required: ["visible", "password"], properties: { visible: { type: "boolean" }, password: { type: "string", format: "password", const: "secret-const" } } },
	},
} as const;

describe("deferred tool approval schema", function _suite()
{
	it("makes secret-bearing reviewed schemas denial-only without projecting any argument", function _projectsSafely()
	{
		const projection = __ProjectDeferredToolApproval(SCHEMA, { query: "quarterly", token: "secret-token", nested: { visible: true, password: "secret-password" } });

		expect(projection.proposedArguments).toBeNull();
		expect(JSON.stringify(projection)).not.toContain("secret-token");
		expect(JSON.stringify(projection)).not.toContain("secret-password");
		expect(JSON.stringify(projection)).not.toContain("secret-default");
		expect(JSON.stringify(projection)).not.toContain("secret-example");
		expect(JSON.stringify(projection)).not.toContain("secret-const");
		expect(projection.responseSchema).toEqual({ oneOf: [{ type: "object", additionalProperties: false, required: ["decision"], properties: { decision: { const: "denied" } } }] });
		expect(__IsDeferredToolApprovalReplacementAllowed(SCHEMA)).toBe(false);
	});

	it("follows local refs and every schema combinator before admitting actor-visible details", function _FollowsReferences()
	{
		for (const keyword of ["allOf", "anyOf", "oneOf"])
		{
			const schema = { type: "object", properties: { value: { [keyword]: [{ $ref: "#/$defs/secret" }, { type: "string" }] } }, $defs: { secret: { type: "string", "x-secret": true, default: "never-visible" } } };
			const projection = __ProjectDeferredToolApproval(schema as unknown as JsonValue, { value: "never-visible" });
			expect(projection.proposedArguments).toBeNull();
			expect(JSON.stringify(projection)).not.toContain("never-visible");
		}
	});

	it("fails projection closed for unresolved or external references", function _RejectsUnknownReferences()
	{
		for (const reference of ["#/$defs/missing", "https://example.invalid/schema.json"])
		{
			expect(__ProjectDeferredToolApproval({ $ref: reference }, { token: "never-visible" }).proposedArguments).toBeNull();
		}
	});

	it("validates only complete replacements against the frozen reviewed schema", function _validatesFullReplacement()
	{
		expect(__ValidateDeferredToolArguments(SCHEMA, { query: "updated", token: "new-token", nested: { visible: false, password: "secret-const" } })).toBe(true);
		expect(__ValidateDeferredToolArguments(SCHEMA, { query: "partial" })).toBe(false);
		expect(__ValidateDeferredToolArguments(SCHEMA, { query: "updated", token: "new-token", nested: { visible: false, password: "secret-const" }, runId: "forged" })).toBe(false);
	});

	it("fails closed when a frozen schema is malformed", function _rejectsMalformedSchema()
	{
		expect(__ValidateDeferredToolArguments({ type: "not-a-json-schema-type" }, { query: "value" })).toBe(false);
	});
});
