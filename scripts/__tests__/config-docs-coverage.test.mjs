import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { inspectConfigDocsCoverage } from "../config-docs-coverage.core.mjs";

/** Repository root used by the fixture contract. */
const _ROOT = fileURLToPath(new URL("../../", import.meta.url));
/** Fixture contract that classifies every root and documents the public input. */
const _CONTRACT = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/config-docs-coverage/contract.json", import.meta.url)), "utf8"));

test("accepts a complete operator input, forwarded key, and internal key contract", function _AcceptsCompleteContract()
{
	const coverage = inspectConfigDocsCoverage(_CONTRACT, _ROOT);
	assert.deepEqual(coverage.errors, []);
	assert.deepEqual(coverage.missingDocumentation, []);
});

test("reports an operator input whose declared document omits the exact key", function _ReportsMissingDocumentation()
{
	const contract = structuredClone(_CONTRACT);
	contract.charts[0].operatorInputs[0].documentation = "scripts/__tests__/fixtures/config-docs-coverage/docs/missing.md";
	const coverage = inspectConfigDocsCoverage(contract, _ROOT);
	assert.deepEqual(coverage.errors, []);
	assert.deepEqual(coverage.missingDocumentation, ["scripts/__tests__/fixtures/config-docs-coverage/chart: operator -> scripts/__tests__/fixtures/config-docs-coverage/docs/missing.md"]);
});

test("fails closed when a values root has no explicit classification", function _RejectsUnclassifiedKey()
{
	const contract = structuredClone(_CONTRACT);
	contract.charts[0].internalKeys = [];
	const coverage = inspectConfigDocsCoverage(contract, _ROOT);
	assert.deepEqual(coverage.missingDocumentation, []);
	assert.deepEqual(coverage.errors, ["scripts/__tests__/fixtures/config-docs-coverage/chart: 'internal' is not classified as an operator input, forwarded key, or internal key."]);
});

test("fails closed when a forwarded value names a stale owning chart", function _RejectsMissingOwner()
{
	const contract = structuredClone(_CONTRACT);
	contract.charts[0].forwardedKeys[0].owner = "scripts/__tests__/fixtures/config-docs-coverage/missing-chart";
	const coverage = inspectConfigDocsCoverage(contract, _ROOT);
	assert.deepEqual(coverage.missingDocumentation, []);
	assert.deepEqual(coverage.errors, ["scripts/__tests__/fixtures/config-docs-coverage/chart: forwarded key 'forwarded' names missing owner 'scripts/__tests__/fixtures/config-docs-coverage/missing-chart'."]);
});
