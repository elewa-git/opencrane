import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { findingDelta, inspectPrismaBoundary, prismaModelDelegates, resolveExemptions, validateOwnerDeclarations, validatePolicy, validateRawProcedureDeclarations } from "../prisma-boundary/core.mjs";

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
/** The sole policy-owned raw database procedure used by the workflow engine adapter. */
const _RAW_PROCEDURE_CALLS = [{
	path: "libs/widgets/workflow-task-admission.ts",
	adapter: "WorkflowTaskAdmission",
	contract: "IWorkflowTaskAdmission",
	contractImportPath: "./workflow-task-admission.types",
	method: "$queryRaw",
	sqlTemplate: "SELECT task_id, run_id, attempt, created FROM absurd.spawn_task(${this.queueName}, ${taskName}, ${input}::jsonb, ${admissionOptions}::jsonb)",
	reason: "The test models the reviewed task-admission procedure boundary.",
}];

/** Reads one TypeScript fixture stored as inert text. */
function _Fixture(name)
{
	return readFileSync(join(_FIXTURES, `${name}.ts.txt`), "utf8");
}

test("allows imported repository and unit-of-work contract owners", function _AllowsOwners()
{
	assert.doesNotThrow(function _ValidPolicy() { validatePolicy({ version: 1, owners: _OWNERS, rawProcedureCalls: [], exemptions: [] }); });
	assert.deepEqual(inspectPrismaBoundary("libs/widgets/prisma-widget-repository.ts", _Fixture("positive-repository"), ["widget"], _OWNERS), []);
	assert.deepEqual(inspectPrismaBoundary("libs/widgets/prisma-widget-unit-of-work.ts", _Fixture("positive-unit-of-work"), ["widget"], _OWNERS), []);
});

test("allows exact live contracts without empty repository aliases", function _AllowsLiveContracts()
{
	const liveContracts = {
		repositories: [{ ..._OWNERS.repositories[0], contract: "WidgetPort" }],
		unitsOfWork: [{ ..._OWNERS.unitsOfWork[0], contract: "WidgetAuthority" }],
		compositions: [],
	};
	assert.doesNotThrow(function _ValidPolicy() { validatePolicy({ version: 1, owners: liveContracts, rawProcedureCalls: [], exemptions: [] }); });
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

test("forbids every raw Prisma method inside a policy-authorized repository", function _RejectsAuthorizedRepositoryRawMethods()
{
	const findings = inspectPrismaBoundary("libs/widgets/prisma-widget-repository.ts", _Fixture("negative-authorized-repository-raw-methods"), ["widget"], _OWNERS);
	const rawFindings = findings.filter(function _Raw(finding) { return finding.rule === "PRISMA-RAW-QUERY-FORBIDDEN"; });
	assert.equal(rawFindings.length, 4);
	assert.deepEqual(rawFindings.map(function _Message(finding) { return finding.message.split(" ")[0]; }).sort(), [
		"$executeRaw",
		"$executeRawUnsafe",
		"$queryRaw",
		"$queryRawUnsafe",
	]);
});

test("allows only the fixed typed Absurd task-admission call", function _AllowsRawTaskAdmission()
{
	const source = "import { Prisma } from \"@prisma/client\";\nimport type { IWorkflowTaskAdmission } from \"./workflow-task-admission.types\";\nexport class WorkflowTaskAdmission implements IWorkflowTaskAdmission { async admit(client: Prisma.TransactionClient) { return client.$queryRaw(Prisma.sql`SELECT task_id, run_id, attempt, created FROM absurd.spawn_task(${this.queueName}, ${taskName}, ${input}::jsonb, ${admissionOptions}::jsonb)`); } }\n";
	const alteredTemplate = source.replace("attempt, created", "attempt, created, ignored");
	assert.deepEqual(inspectPrismaBoundary("libs/widgets/workflow-task-admission.ts", source, ["widget"], _OWNERS, new Set(), _RAW_PROCEDURE_CALLS), []);
	assert.equal(inspectPrismaBoundary("libs/widgets/workflow-task-admission.ts", alteredTemplate, ["widget"], _OWNERS, new Set(), _RAW_PROCEDURE_CALLS).some(function _Raw(finding) { return finding.rule === "PRISMA-RAW-QUERY-FORBIDDEN"; }), true);
	assert.deepEqual(validateRawProcedureDeclarations("libs/widgets/workflow-task-admission.ts", source, _RAW_PROCEDURE_CALLS), []);
	assert.equal(validateRawProcedureDeclarations("libs/widgets/workflow-task-admission.ts", source.replace("client.$queryRaw", "client.$executeRaw"), _RAW_PROCEDURE_CALLS).some(function _Policy(finding) { return finding.rule === "PRISMA-POLICY-RAW-PROCEDURE"; }), true);
});

test("reads the former task-admission declaration only when a diff loads its base policy", function _AllowsLegacyRawProcedureInBase()
{
	const legacy = {
		path: "libs/widgets/prisma-db-procedure-gateway.ts",
		adapter: "PrismaDbProcedureGateway",
		contract: "AbsurdTaskAdmissionProcedure",
		contractImportPath: "./absurd-transaction-spawner.types",
		method: "$queryRaw",
		sqlTemplate: "SELECT task_id, run_id, attempt, created FROM absurd.spawn_task(${this.queueName}, ${taskName}, ${input}::jsonb, ${options}::jsonb)",
		reason: "The old policy proves that the diff reads the previous exact database boundary.",
	};
	assert.throws(function _CurrentPolicyRejectsLegacy() { validatePolicy({ version: 1, owners: _OWNERS, rawProcedureCalls: [legacy], exemptions: [] }); }, /invalid raw procedure call/u);
	assert.doesNotThrow(function _BasePolicyAcceptsLegacy() { validatePolicy({ version: 1, owners: _OWNERS, rawProcedureCalls: [legacy], exemptions: [] }, true); });
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

test("detects computed and aliased raw Prisma access without matching prose", function _ScopesRawMethods()
{
	const bypass = inspectPrismaBoundary("libs/widgets/computed-service.ts", _Fixture("negative-computed-raw-service"), ["widget"], _OWNERS);
	const examples = inspectPrismaBoundary("libs/widgets/examples.ts", _Fixture("positive-raw-false-positives"), ["widget"], _OWNERS);
	assert.equal(bypass.filter(function _Raw(finding) { return finding.rule === "PRISMA-RAW-QUERY-FORBIDDEN"; }).length, 2);
	assert.equal(examples.some(function _Raw(finding) { return finding.rule === "PRISMA-RAW-QUERY-FORBIDDEN"; }), false);
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

test("extracts canonical model and view delegate names from Prisma schemas", function _ExtractsDelegates()
{
	assert.deepEqual(prismaModelDelegates(["model Widget {\n id String @id\n}\nmodel APIKey {\n id String @id\n}\nview ClaimCandidate {\n id String @unique\n}\n"]), ["aPIKey", "claimCandidate", "widget"]);
});

test("fails closed on broad, ownerless, stale, or malformed exemptions", function _RejectsMalformedExemptions()
{
	const resolved = resolveExemptions([
		{ path: "libs/*/service.ts", operations: ["delegate"], owner: "team", reason: "A sufficiently detailed temporary reason.", expiresOn: "2026-09-01" },
		{ path: "libs/service.ts", operations: ["unknown"], owner: "", reason: "short", expiresOn: "tomorrow" },
		{ path: "libs/expired.ts", operations: ["transaction"], owner: "team", reason: "A sufficiently detailed temporary reason.", expiresOn: "2026-07-01" },
		{ path: "libs/impossible-date.ts", operations: ["delegate"], owner: "team", reason: "A sufficiently detailed temporary reason.", expiresOn: "2026-02-30" },
		{ path: "libs/raw-method.ts", operations: ["raw-query"], owner: "team", reason: "Raw Prisma methods must never be exemptible.", expiresOn: "2026-09-01" },
	], "2026-08-01");
	assert.equal(resolved.active.size, 0);
	assert.equal(resolved.errors.length, 5);
	assert.throws(function _InvalidPolicy() { validatePolicy({ version: 2, owners: { repositories: [], unitsOfWork: [], compositions: [] }, rawProcedureCalls: [], exemptions: [] }); }, /invalid Prisma-boundary policy schema/u);
	assert.throws(function _BroadOwner() { validatePolicy({ version: 1, owners: { repositories: [{ path: "libs/*/repository.ts", adapter: "PrismaWidgetRepository", contract: "WidgetRepository", contractImportPath: "./widget.types.js", constructs: [] }], unitsOfWork: [], compositions: [] }, rawProcedureCalls: [], exemptions: [] }); }, /invalid Prisma-boundary owner/u);
	assert.throws(function _WrongAdapterKind() { validatePolicy({ version: 1, owners: { repositories: [{ path: "libs/widget.ts", adapter: "PrismaWidgetService", contract: "WidgetPort", contractImportPath: "./widget.types.js", constructs: [] }], unitsOfWork: [], compositions: [] }, rawProcedureCalls: [], exemptions: [] }); }, /invalid Prisma-boundary owner/u);
	assert.throws(function _WrongRawProcedure() { validatePolicy({ version: 1, owners: _OWNERS, rawProcedureCalls: [{ ..._RAW_PROCEDURE_CALLS[0], method: "$queryRawUnsafe" }], exemptions: [] }); }, /invalid raw procedure call/u);
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
