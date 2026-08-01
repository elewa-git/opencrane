import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { findingDelta, inspectPrismaBoundary, prismaModelDelegates, resolveExemptions, validatePolicy } from "../prisma-boundary/core.mjs";

/** Fixture directory for deterministic ownership examples. */
const _FIXTURES = fileURLToPath(new URL("./fixtures/prisma-boundary/", import.meta.url));
/** Repository root used to verify reviewer pipeline integration. */
const _ROOT = fileURLToPath(new URL("../../", import.meta.url));
/** Authoritative owner contracts used by checker fixtures. */
const _OWNERS = {
	repositories: [{ contract: "WidgetRepository", importPath: "./widget.types.js" }],
	unitsOfWork: [{ contract: "WidgetUnitOfWork", importPath: "./widget.types.js" }],
	compositions: [],
};

/** Reads one TypeScript fixture stored as inert text. */
function _Fixture(name)
{
	return readFileSync(join(_FIXTURES, `${name}.ts.txt`), "utf8");
}

test("allows imported repository and unit-of-work contract owners", function _AllowsOwners()
{
	assert.deepEqual(inspectPrismaBoundary("libs/widgets/prisma-widget-repository.ts", _Fixture("positive-repository"), ["widget"], _OWNERS), []);
	assert.deepEqual(inspectPrismaBoundary("libs/widgets/prisma-widget-unit-of-work.ts", _Fixture("positive-unit-of-work"), ["widget"], _OWNERS), []);
});

test("rejects service code that calls delegates and transactions directly", function _RejectsServiceBypass()
{
	const findings = inspectPrismaBoundary("libs/widgets/widget-service.ts", _Fixture("negative-service"), ["widget"], _OWNERS);
	assert.deepEqual(findings.map(function _Rule(finding) { return finding.rule; }), [
		"PRISMA-IMPORT-OWNER",
		"PRISMA-TRANSACTION-OWNER",
		"PRISMA-DELEGATE-OWNER",
	]);
});

test("requires the exact authoritative contract import rather than a marker naming trick", function _RejectsNamingTrick()
{
	const source = "import type { WidgetRepository } from \"./fake.types.js\";\nclass Service implements WidgetRepository { async run() { return this.prisma.widget.findFirst({}); } }\n";
	const findings = inspectPrismaBoundary("libs/widgets/service.ts", source, ["widget"], _OWNERS);
	assert.equal(findings.some(function _Delegate(finding) { return finding.rule === "PRISMA-DELEGATE-OWNER"; }), true);
});

test("rejects aliased imports, delegate aliases, destructuring, and transaction aliases", function _RejectsAliases()
{
	const findings = inspectPrismaBoundary("libs/widgets/aliased-service.ts", _Fixture("negative-aliases"), ["gadget", "widget"], _OWNERS);
	assert.equal(findings.filter(function _Transactions(finding) { return finding.rule === "PRISMA-TRANSACTION-OWNER"; }).length, 1);
	assert.equal(findings.filter(function _Delegates(finding) { return finding.rule === "PRISMA-DELEGATE-OWNER"; }).length, 3);
});

test("checks the complete changed file when an ownership declaration is removed", function _RejectsRemovedOwner()
{
	const base = inspectPrismaBoundary("libs/widgets/prisma-widget-store.ts", _Fixture("positive-repository"), ["widget"], _OWNERS);
	const current = inspectPrismaBoundary("libs/widgets/prisma-widget-store.ts", _Fixture("negative-removed-owner"), ["widget"], _OWNERS);
	const introduced = findingDelta(base, current);
	assert.equal(introduced.some(function _Delegate(finding) { return finding.rule === "PRISMA-DELEGATE-OWNER"; }), true);
});

test("excludes unchanged inherited findings while preserving new duplicates", function _DiffsFindingMultisets()
{
	const inherited = { path: "service.ts", line: 10, rule: "PRISMA-DELEGATE-OWNER", message: "direct widget.findFirst call", owner: "function:_Legacy" };
	const current = [{ ...inherited, line: 20 }, { ...inherited, line: 30 }];
	assert.deepEqual(findingDelta([inherited], current), [current[1]]);
});

test("treats relocation to a different owner as a new bypass", function _DetectsRelocation()
{
	const base = inspectPrismaBoundary("libs/widgets/service.ts", "function _Legacy() { return prisma.widget.findFirst({}); }", ["widget"], _OWNERS);
	const current = inspectPrismaBoundary("libs/widgets/service.ts", "function _Materializer() { return prisma.widget.findFirst({}); }", ["widget"], _OWNERS);
	assert.equal(findingDelta(base, current).length, 1);
});

test("extracts canonical delegate names from Prisma schemas", function _ExtractsModels()
{
	assert.deepEqual(prismaModelDelegates(["model Widget {\n id String @id\n}\nmodel APIKey {\n id String @id\n}\n"]), ["aPIKey", "widget"]);
});

test("fails closed on broad, ownerless, stale, or malformed exemptions", function _RejectsMalformedExemptions()
{
	const resolved = resolveExemptions([
		{ path: "libs/*/service.ts", operations: ["delegate"], owner: "team", reason: "A sufficiently detailed temporary reason.", expiresOn: "2026-09-01" },
		{ path: "libs/service.ts", operations: ["unknown"], owner: "", reason: "short", expiresOn: "tomorrow" },
		{ path: "libs/expired.ts", operations: ["transaction"], owner: "team", reason: "A sufficiently detailed temporary reason.", expiresOn: "2026-07-01" },
	], "2026-08-01");
	assert.equal(resolved.active.size, 0);
	assert.equal(resolved.errors.length, 3);
	assert.throws(function _InvalidPolicy() { validatePolicy({ version: 2, owners: { repositories: [], unitsOfWork: [], compositions: [] }, exemptions: [] }); }, /invalid Prisma-boundary policy schema/u);
	assert.throws(function _BroadOwner() { validatePolicy({ version: 1, owners: { repositories: [{ contract: "WidgetRepository", importPath: "./*.types.js" }], unitsOfWork: [], compositions: [] }, exemptions: [] }); }, /invalid Prisma-boundary owner contract/u);
});

test("keeps review, style, package, and CI surfaces on the boundary check", function _VerifiesPipeline()
{
	const surfaces = [
		".agents/skills/review/SKILL.md",
		".claude/agents/review.md",
		".codex/agents/review.toml",
		"scripts/agent-style-check.sh",
		"package.json",
		".github/workflows/docker.yml",
		".github/workflows/nightly.yml",
	];
	for (const path of surfaces)
	{
		assert.match(readFileSync(join(_ROOT, path), "utf8"), /prisma-boundar/u, path);
	}
});
