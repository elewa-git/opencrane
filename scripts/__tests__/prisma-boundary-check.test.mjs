import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { findingDelta, inspectPrismaBoundary, prismaModelDelegates, resolveExemptions, validateOwnerDeclarations, validatePolicy } from "../prisma-boundary/core.mjs";

/** Fixture directory for deterministic ownership examples. */
const _FIXTURES = fileURLToPath(new URL("./fixtures/prisma-boundary/", import.meta.url));
/** Repository root used to verify reviewer pipeline integration. */
const _ROOT = fileURLToPath(new URL("../../", import.meta.url));
/** Authoritative owner contracts used by checker fixtures. */
const _OWNERS = {
	repositories: [{ path: "libs/widgets/prisma-widget-repository.ts", adapter: "PrismaWidgetRepository", contract: "WidgetRepository", contractImportPath: "./widget.types.js", constructs: [] }],
	unitsOfWork: [{ path: "libs/widgets/prisma-widget-unit-of-work.ts", adapter: "PrismaWidgetUnitOfWork", contract: "WidgetUnitOfWork", contractImportPath: "./widget.types.js", constructs: [{ adapter: "PrismaWidgetRepository", importPath: "./prisma-widget-repository.js" }] }],
	compositions: [],
};

/** Reads one TypeScript fixture stored as inert text. */
function _Fixture(name)
{
	return readFileSync(join(_FIXTURES, `${name}.ts.txt`), "utf8");
}

test("allows imported repository and unit-of-work contract owners", function _AllowsOwners()
{
	assert.doesNotThrow(function _ValidPolicy() { validatePolicy({ version: 1, owners: _OWNERS, exemptions: [] }); });
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

test("requires the exact policy path and adapter name for Prisma ownership", function _RejectsRenamedOwner()
{
	const renamed = _Fixture("positive-repository").replaceAll("PrismaWidgetRepository", "PrismaRenamedRepository");
	const renamedFindings = inspectPrismaBoundary("libs/widgets/prisma-widget-repository.ts", renamed, ["widget"], _OWNERS);
	const movedFindings = inspectPrismaBoundary("libs/widgets/moved-prisma-widget-repository.ts", _Fixture("positive-repository"), ["widget"], _OWNERS);
	assert.equal(renamedFindings.some(function _Delegate(finding) { return finding.rule === "PRISMA-DELEGATE-OWNER"; }), true);
	assert.equal(movedFindings.some(function _Import(finding) { return finding.rule === "PRISMA-IMPORT-OWNER"; }), true);
});

test("allows raw queries only in exact policy-authorized repository adapters", function _RejectsUnitOfWorkRawQuery()
{
	const repository = inspectPrismaBoundary("libs/widgets/prisma-widget-repository.ts", _Fixture("positive-repository"), ["widget"], _OWNERS);
	const unitOfWork = inspectPrismaBoundary("libs/widgets/prisma-widget-unit-of-work.ts", _Fixture("negative-unit-of-work-raw-query"), ["widget"], _OWNERS);
	assert.equal(repository.some(function _Raw(finding) { return finding.rule === "PRISMA-RAW-QUERY-OWNER"; }), false);
	assert.equal(unitOfWork.some(function _Raw(finding) { return finding.rule === "PRISMA-RAW-QUERY-OWNER"; }), true);
});

test("requires transaction-scoped repository construction to match the owning policy entry", function _RejectsUndeclaredConstruction()
{
	const undeclared = { ..._OWNERS, unitsOfWork: [{ ..._OWNERS.unitsOfWork[0], constructs: [] }] };
	const findings = inspectPrismaBoundary("libs/widgets/prisma-widget-unit-of-work.ts", _Fixture("positive-unit-of-work"), ["widget"], undeclared);
	const rootClient = inspectPrismaBoundary("libs/widgets/prisma-widget-unit-of-work.ts", _Fixture("negative-root-client-unit-of-work"), ["widget"], _OWNERS);
	const configured = inspectPrismaBoundary("libs/widgets/prisma-widget-unit-of-work.ts", _Fixture("positive-unit-of-work").replace("new PrismaWidgetRepository(tx)", "new PrismaWidgetRepository(tx, leaseMilliseconds)"), ["widget"], _OWNERS);
	const configuredRootClient = inspectPrismaBoundary("libs/widgets/prisma-widget-unit-of-work.ts", _Fixture("positive-unit-of-work").replace("new PrismaWidgetRepository(tx)", "new PrismaWidgetRepository(tx, this.prisma)"), ["widget"], _OWNERS);
	const nestedRootClient = inspectPrismaBoundary("libs/widgets/prisma-widget-unit-of-work.ts", _Fixture("positive-unit-of-work").replace("new PrismaWidgetRepository(tx)", "new PrismaWidgetRepository(tx, { client: this.prisma })"), ["widget"], _OWNERS);
	const aliasedRootClient = inspectPrismaBoundary("libs/widgets/prisma-widget-unit-of-work.ts", _Fixture("positive-unit-of-work").replace("return this.prisma.$transaction", "const root = this.prisma; return this.prisma.$transaction").replace("new PrismaWidgetRepository(tx)", "new PrismaWidgetRepository(tx, { client: root })"), ["widget"], _OWNERS);
	const namedRootConfig = inspectPrismaBoundary("libs/widgets/prisma-widget-unit-of-work.ts", _Fixture("positive-unit-of-work").replace("return this.prisma.$transaction", "const config = { client: this.prisma }; return this.prisma.$transaction").replace("new PrismaWidgetRepository(tx)", "new PrismaWidgetRepository(tx, config)"), ["widget"], _OWNERS);
	assert.equal(findings.some(function _Construction(finding) { return finding.rule === "PRISMA-REPOSITORY-CONSTRUCTION"; }), true);
	assert.equal(rootClient.some(function _Construction(finding) { return finding.rule === "PRISMA-REPOSITORY-CONSTRUCTION"; }), true);
	assert.equal(configured.some(function _Construction(finding) { return finding.rule === "PRISMA-REPOSITORY-CONSTRUCTION"; }), false);
	assert.equal(configuredRootClient.some(function _Construction(finding) { return finding.rule === "PRISMA-REPOSITORY-CONSTRUCTION"; }), true);
	assert.equal(nestedRootClient.some(function _Construction(finding) { return finding.rule === "PRISMA-REPOSITORY-CONSTRUCTION"; }), true);
	assert.equal(aliasedRootClient.some(function _Construction(finding) { return finding.rule === "PRISMA-REPOSITORY-CONSTRUCTION"; }), true);
	assert.equal(namedRootConfig.some(function _Construction(finding) { return finding.rule === "PRISMA-REPOSITORY-CONSTRUCTION"; }), true);
});

test("fails closed when live owner declarations drift from policy", function _RejectsStaleOwnerPolicy()
{
	const renamed = _Fixture("positive-repository").replaceAll("PrismaWidgetRepository", "PrismaRenamedRepository");
	const missingConstruction = _Fixture("positive-unit-of-work").replace("return new PrismaWidgetRepository(tx);", "return tx;");
	const rootClientConstructor = _Fixture("positive-repository")
		.replace("import type { Prisma }", "import type { Prisma, PrismaClient }")
		.replace("constructor(transaction: Prisma.TransactionClient)", "constructor(transaction: PrismaClient)");
	const secondaryRootClientConstructor = _Fixture("positive-repository")
		.replace("import type { Prisma }", "import type { Prisma, PrismaClient }")
		.replace("constructor(transaction: Prisma.TransactionClient)", "constructor(transaction: Prisma.TransactionClient, prisma: PrismaClient)");
	const optionalRootClientConstructor = _Fixture("positive-repository")
		.replace("import type { Prisma }", "import type { Prisma, PrismaClient }")
		.replace("constructor(transaction: Prisma.TransactionClient)", "constructor(transaction: Prisma.TransactionClient, prisma?: PrismaClient)");
	const wrappedRootClientConstructor = _Fixture("positive-repository")
		.replace("import type { Prisma }", "import type { Prisma, PrismaClient }")
		.replace("constructor(transaction: Prisma.TransactionClient)", "constructor(transaction: Prisma.TransactionClient, prisma: Readonly<PrismaClient>)");
	const ownerFindings = validateOwnerDeclarations("libs/widgets/prisma-widget-repository.ts", renamed, _OWNERS);
	const constructionFindings = validateOwnerDeclarations("libs/widgets/prisma-widget-unit-of-work.ts", missingConstruction, _OWNERS);
	const constructorFindings = validateOwnerDeclarations("libs/widgets/prisma-widget-repository.ts", rootClientConstructor, _OWNERS);
	const secondaryConstructorFindings = validateOwnerDeclarations("libs/widgets/prisma-widget-repository.ts", secondaryRootClientConstructor, _OWNERS);
	const optionalConstructorFindings = validateOwnerDeclarations("libs/widgets/prisma-widget-repository.ts", optionalRootClientConstructor, _OWNERS);
	const wrappedConstructorFindings = validateOwnerDeclarations("libs/widgets/prisma-widget-repository.ts", wrappedRootClientConstructor, _OWNERS);
	assert.equal(ownerFindings.some(function _Owner(finding) { return finding.rule === "PRISMA-POLICY-OWNER"; }), true);
	assert.equal(constructionFindings.some(function _Construction(finding) { return finding.rule === "PRISMA-POLICY-CONSTRUCTION"; }), true);
	assert.equal(constructorFindings.some(function _Owner(finding) { return finding.rule === "PRISMA-POLICY-OWNER"; }), true);
	assert.equal(secondaryConstructorFindings.some(function _Owner(finding) { return finding.rule === "PRISMA-POLICY-OWNER"; }), true);
	assert.equal(optionalConstructorFindings.some(function _Owner(finding) { return finding.rule === "PRISMA-POLICY-OWNER"; }), true);
	assert.equal(wrappedConstructorFindings.some(function _Owner(finding) { return finding.rule === "PRISMA-POLICY-OWNER"; }), true);
});

test("detects computed raw-query access without matching prose or unrelated receivers", function _ScopesRawQueries()
{
	const bypass = inspectPrismaBoundary("libs/widgets/computed-service.ts", _Fixture("negative-computed-raw-service"), ["widget"], _OWNERS);
	const examples = inspectPrismaBoundary("libs/widgets/examples.ts", _Fixture("positive-raw-false-positives"), ["widget"], _OWNERS);
	assert.equal(bypass.filter(function _Raw(finding) { return finding.rule === "PRISMA-RAW-QUERY-OWNER"; }).length, 2);
	assert.equal(examples.some(function _Raw(finding) { return finding.rule === "PRISMA-RAW-QUERY-OWNER"; }), false);
});

test("rejects aliased imports, delegate aliases, destructuring, and transaction aliases", function _RejectsAliases()
{
	const findings = inspectPrismaBoundary("libs/widgets/aliased-service.ts", _Fixture("negative-aliases"), ["gadget", "widget"], _OWNERS);
	assert.equal(findings.filter(function _Transactions(finding) { return finding.rule === "PRISMA-TRANSACTION-OWNER"; }).length, 1);
	assert.equal(findings.filter(function _Delegates(finding) { return finding.rule === "PRISMA-DELEGATE-OWNER"; }).length, 3);
});

test("checks the complete changed file when an ownership declaration is removed", function _RejectsRemovedOwner()
{
	const base = inspectPrismaBoundary("libs/widgets/prisma-widget-repository.ts", _Fixture("positive-repository"), ["widget"], _OWNERS);
	const current = inspectPrismaBoundary("libs/widgets/prisma-widget-repository.ts", _Fixture("negative-removed-owner"), ["widget"], _OWNERS);
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
		{ path: "libs/impossible-date.ts", operations: ["delegate"], owner: "team", reason: "A sufficiently detailed temporary reason.", expiresOn: "2026-02-30" },
	], "2026-08-01");
	assert.equal(resolved.active.size, 0);
	assert.equal(resolved.errors.length, 4);
	assert.throws(function _InvalidPolicy() { validatePolicy({ version: 2, owners: { repositories: [], unitsOfWork: [], compositions: [] }, exemptions: [] }); }, /invalid Prisma-boundary policy schema/u);
	assert.throws(function _BroadOwner() { validatePolicy({ version: 1, owners: { repositories: [{ path: "libs/*/repository.ts", adapter: "PrismaWidgetRepository", contract: "WidgetRepository", contractImportPath: "./widget.types.js", constructs: [] }], unitsOfWork: [], compositions: [] }, exemptions: [] }); }, /invalid Prisma-boundary owner/u);
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
		"docs/agents/prisma.md",
		"docs/agents/workflow.md",
	];
	for (const path of surfaces)
	{
		assert.match(readFileSync(join(_ROOT, path), "utf8"), /prisma-boundar/u, path);
	}
});
