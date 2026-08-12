import { describe, expect, it } from "vitest";

import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { __AreReviewedIntegrationToolDefinitionsValid, __IsReviewedIntegrationToolDefinitionValid } from "../agent-tool-definition.validator.js";
import type { ReviewedIntegrationToolDefinition } from "../agent-revision.types.js";

/** Build one reviewed definition with required, typed, closed input members. */
function _Definition(parametersSchema: JsonValue = { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string" } } }): ReviewedIntegrationToolDefinition
{
	return { name: "search", description: "Search records", parametersSchema, parametersSchemaDigest: ___DigestCanonicalJson(parametersSchema) };
}

describe("reviewed integration tool definitions", function _ReviewedToolDefinitionSuite()
{
	it("accepts a complete schema and produces an idempotent canonical digest", function _AcceptsReviewedSchema()
	{
		const first = _Definition();
		const second = _Definition({ properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false, type: "object" });

		expect(__IsReviewedIntegrationToolDefinitionValid(first)).toBe(true);
		expect(second.parametersSchemaDigest).toBe(first.parametersSchemaDigest);
	});

	it("rejects a missing schema, malformed schema, duplicate name, and post-review mutation", function _RejectsInvalidDefinitions()
	{
		const reviewed = _Definition();
		const missing = { ...reviewed, parametersSchema: undefined } as unknown as ReviewedIntegrationToolDefinition;
		const missingName = { ...reviewed, name: undefined } as unknown as ReviewedIntegrationToolDefinition;
		const malformed = _Definition({ type: "not-a-json-schema-type" });
		const mutated = { ...reviewed, parametersSchema: { type: "object", additionalProperties: true } } as ReviewedIntegrationToolDefinition;

		expect(__IsReviewedIntegrationToolDefinitionValid(missing)).toBe(false);
		expect(__IsReviewedIntegrationToolDefinitionValid(missingName)).toBe(false);
		expect(__IsReviewedIntegrationToolDefinitionValid(malformed)).toBe(false);
		expect(__IsReviewedIntegrationToolDefinitionValid(mutated)).toBe(false);
		expect(__AreReviewedIntegrationToolDefinitionsValid([reviewed, reviewed])).toBe(false);
	});
});
