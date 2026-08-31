import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { findingDelta, inspectPrismaBoundary, prepareBasePolicyForComparison, prismaModelDelegates, resolveExemptions, validateOwnerDeclarations, validatePolicy, validateRawProcedureDeclarations } from "../prisma-boundary/core.mjs";
import { rawPrismaMethodMatches } from "../prisma-boundary/prisma-bindings.mjs";
import { inspectRawProcedureCall } from "../prisma-boundary/raw-procedure-inspection.mjs";

/** Fixture directory for deterministic ownership examples. */
const _FIXTURES = fileURLToPath(new URL("./fixtures/prisma-boundary/", import.meta.url));
/** Repository root used to verify reviewer pipeline integration. */
const _ROOT = fileURLToPath(new URL("../../", import.meta.url));
/** Prisma boundary checker entrypoint used with temporary Git repositories for CLI coverage. */
const _CHECKER = fileURLToPath(new URL("../prisma-boundary-check.mjs", import.meta.url));
/** Authoritative owner contracts used by checker fixtures. */
const _OWNERS = {
	repositories: [{ path: "libs/widgets/prisma-widget-repository.ts", adapter: "PrismaWidgetRepository", contract: "WidgetRepository", contractImportPath: "./widget.types.js", constructs: [] }],
	unitsOfWork: [{ path: "libs/widgets/prisma-widget-unit-of-work.ts", adapter: "PrismaWidgetUnitOfWork", contract: "WidgetUnitOfWork", contractImportPath: "./widget.types.js", constructs: [{ adapter: "PrismaWidgetRepository", importPath: "./prisma-widget-repository.js" }] }],
	compositions: [],
};
/** The sole policy-owned raw database procedure used by the workflow engine adapter. */
const _RAW_PROCEDURE_CALL = {
	path: "libs/widgets/workflow-task-admission.ts",
	adapter: "WorkflowTaskAdmission",
	contract: "IWorkflowTaskAdmission",
	contractImportPath: "./workflow-task-admission.types",
	method: "$queryRaw",
	sqlTemplate: "SELECT task_id, run_id, attempt, created FROM absurd.spawn_task(${this.queueName}, ${taskName}, ${input}::jsonb, ${admissionOptions}::jsonb)",
	reason: "The test models the reviewed task-admission procedure boundary.",
};

/** Reads the checked Prisma-boundary policy used by the live repository. */
function _LivePolicy()
{
	return JSON.parse(readFileSync(join(_ROOT, "docs/agents/prisma-boundary-policy.json"), "utf8"));
}

/** Returns structural evidence only when one raw-method match uses the declared method. */
function _RawProcedureEvidence(source, procedure = _RAW_PROCEDURE_CALL)
{
	const matches = rawPrismaMethodMatches(source);
	if (matches.length !== 1 || matches[0].method !== procedure.method) return undefined;
	return inspectRawProcedureCall(source, matches[0], procedure, "Prisma");
}

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

test("recognizes only the exact central authorization transaction helper import", function _AuthorizationTransactionHelper()
{
	const exactHelper = `
import type { Prisma, PrismaClient } from "@prisma/client";
import { ___RunSerializableAuthorizationTransaction } from "@opencrane/backend/server/iam/authorization";
import { PrismaWidgetRepository } from "./prisma-widget-repository.js";
import type { WidgetUnitOfWork } from "./widget.types.js";

export class PrismaWidgetUnitOfWork implements WidgetUnitOfWork
{
	private readonly prisma: PrismaClient;
	constructor(prisma: PrismaClient) { this.prisma = prisma; }
	run(): Promise<unknown>
	{
		return ___RunSerializableAuthorizationTransaction(this.prisma, async function _Run(transaction, _authorization)
		{
			return new PrismaWidgetRepository(transaction);
		});
	}
}
`;
	const lookalikeHelper = exactHelper.replace('from "@opencrane/backend/server/iam/authorization"', 'from "@lookalike/authorization"');
	const exactFindings = inspectPrismaBoundary("libs/widgets/prisma-widget-unit-of-work.ts", exactHelper, ["widget"], _OWNERS);
	const lookalikeFindings = inspectPrismaBoundary("libs/widgets/prisma-widget-unit-of-work.ts", lookalikeHelper, ["widget"], _OWNERS);

	assert.equal(exactFindings.some(function _Construction(finding) { return finding.rule === "PRISMA-REPOSITORY-CONSTRUCTION"; }), false);
	assert.equal(lookalikeFindings.some(function _Construction(finding) { return finding.rule === "PRISMA-REPOSITORY-CONSTRUCTION"; }), true);
});

test("treats an older base policy as having no approved raw procedures", function _AllowsOlderBasePolicy()
{
	const basePolicy = prepareBasePolicyForComparison({ version: 1, owners: _OWNERS, exemptions: [] });
	assert.deepEqual(basePolicy.rawProcedureCalls, []);
	assert.doesNotThrow(function _ValidBasePolicy() { validatePolicy(basePolicy); });
});

test("normalizes only a historical policy when the diff CLI compares schema revisions", function _ComparesOlderPolicy(context)
{
	const repository = mkdtempSync(join(tmpdir(), "opencrane-prisma-policy-"));
	context.after(function _Cleanup() { rmSync(repository, { recursive: true, force: true }); });
	function _Git(...arguments_)
	{
		return execFileSync("git", arguments_, { cwd: repository, encoding: "utf8" }).trim();
	}
	mkdirSync(join(repository, "docs/agents"), { recursive: true });
	mkdirSync(join(repository, "apps/opencrane/prisma/schema"), { recursive: true });
	writeFileSync(join(repository, "apps/opencrane/prisma/schema/core.prisma"), "model Widget {\n id String @id\n}\n");
	const olderPolicy = { version: 1, owners: { repositories: [], unitsOfWork: [], compositions: [] }, exemptions: [] };
	writeFileSync(join(repository, "docs/agents/prisma-boundary-policy.json"), JSON.stringify(olderPolicy));
	_Git("init", "-q");
	_Git("config", "user.name", "OpenCrane test");
	_Git("config", "user.email", "test@opencrane.invalid");
	_Git("config", "commit.gpgSign", "false");
	_Git("add", ".");
	_Git("commit", "-m", "older policy");
	const base = _Git("rev-parse", "HEAD");
	writeFileSync(join(repository, "docs/agents/prisma-boundary-policy.json"), JSON.stringify({ ...olderPolicy, rawProcedureCalls: [] }));
	const output = execFileSync(process.execPath, [_CHECKER, "--diff", base], { cwd: repository, encoding: "utf8" });
	assert.match(output, /0 error\(s\)/u);
	writeFileSync(join(repository, "docs/agents/prisma-boundary-policy.json"), JSON.stringify(olderPolicy));
	assert.throws(function _RejectCurrentPolicy() { execFileSync(process.execPath, [_CHECKER, "--all"], { cwd: repository, stdio: "pipe" }); }, /Command failed/u);
});

test("checks unchanged sources when policy permissions are removed", function _RejectsRemovedPolicyPermissions(context)
{
	const repository = mkdtempSync(join(tmpdir(), "opencrane-prisma-policy-removal-"));
	context.after(function _Cleanup() { rmSync(repository, { recursive: true, force: true }); });
	function _Git(...arguments_)
	{
		return execFileSync("git", arguments_, { cwd: repository, encoding: "utf8" }).trim();
	}
	const rawProcedure = _LivePolicy().rawProcedureCalls[0];
	const historicalRawProcedure = { ...rawProcedure };
	delete historicalRawProcedure.sourceSha256;
	const basePolicy = {
		version: 1,
		owners: {
			repositories: [_OWNERS.repositories[0]],
			unitsOfWork: [],
			compositions: ["libs/widgets/composition.ts"],
		},
		rawProcedureCalls: [historicalRawProcedure],
		exemptions: [{ path: "libs/widgets/exempt-service.ts", operations: ["delegate"], owner: "workflow-team", reason: "The fixture proves removal inspects unchanged exempted source.", expiresOn: "2099-12-31" }],
	};
	mkdirSync(join(repository, "docs/agents"), { recursive: true });
	mkdirSync(join(repository, "apps/opencrane/prisma/schema"), { recursive: true });
	mkdirSync(join(repository, "libs/widgets"), { recursive: true });
	mkdirSync(join(repository, rawProcedure.path, ".."), { recursive: true });
	writeFileSync(join(repository, "apps/opencrane/prisma/schema/core.prisma"), "model Widget {\n id String @id\n}\n");
	writeFileSync(join(repository, "libs/widgets/prisma-widget-repository.ts"), _Fixture("positive-repository"));
	writeFileSync(join(repository, "libs/widgets/composition.ts"), 'import { PrismaClient } from "@prisma/client";\nexport const prisma = new PrismaClient();\n');
	writeFileSync(join(repository, "libs/widgets/exempt-service.ts"), "export function loadWidget() { return prisma.widget.findFirst({}); }\n");
	writeFileSync(join(repository, rawProcedure.path), readFileSync(join(_ROOT, rawProcedure.path), "utf8"));
	writeFileSync(join(repository, "docs/agents/prisma-boundary-policy.json"), JSON.stringify(basePolicy));
	_Git("init", "-q");
	_Git("config", "user.name", "OpenCrane test");
	_Git("config", "user.email", "test@opencrane.invalid");
	_Git("config", "commit.gpgSign", "false");
	_Git("add", ".");
	_Git("commit", "-m", "policy-owned sources");
	const base = _Git("rev-parse", "HEAD");
	writeFileSync(join(repository, "docs/agents/prisma-boundary-policy.json"), JSON.stringify({ version: 1, owners: { repositories: [], unitsOfWork: [], compositions: [] }, rawProcedureCalls: [], exemptions: [] }));
	let output = "";
	try
	{
		execFileSync(process.execPath, [_CHECKER, "--diff", base], { cwd: repository, encoding: "utf8", stdio: "pipe" });
	}
	catch (cause)
	{
		output = `${cause.stdout ?? ""}\n${cause.stderr ?? ""}`;
	}
	assert.match(output, /prisma-widget-repository\.ts.*PRISMA-IMPORT-OWNER/su);
	assert.match(output, /composition\.ts.*PRISMA-IMPORT-OWNER/su);
	assert.match(output, /exempt-service\.ts.*PRISMA-DELEGATE-OWNER/su);
	assert.match(output, /workflow-task-admission\.ts.*PRISMA-RAW-QUERY-FORBIDDEN/su);
	assert.match(output, /4 production TypeScript file\(s\) checked/u);
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
	const direct = "import type { Prisma } from \"@prisma/client\";\nimport type { IWorkflowTaskAdmission } from \"./workflow-task-admission.types\";\nimport { _RequireWorkflowTransactionClient } from \"./workflow-transaction-client\";\nexport class WorkflowTaskAdmission implements IWorkflowTaskAdmission { async admit(transactionClient: unknown) { _RequireWorkflowTransactionClient(transactionClient); const client = transactionClient as Prisma.TransactionClient; return client.$queryRaw<readonly unknown[]>`SELECT task_id, run_id, attempt, created FROM absurd.spawn_task(${this.queueName}, ${taskName}, ${input}::jsonb, ${admissionOptions}::jsonb)`; } }\n";
	const mutations = [
		direct.replace("attempt, created", "attempt, created, ignored"),
		direct.replace("<readonly unknown[]>", ""),
		direct.replace("$queryRaw<readonly unknown[]>`", "$queryRaw<readonly unknown[]>(sql`"),
		direct.replace("$queryRaw", "$queryRawUnsafe"),
		direct.replace("`; } }", "`, extra; } }"),
		direct.replace("client.$queryRaw", "this.rootClient.$queryRaw"),
		direct.replace("client.$queryRaw", "otherClient.$queryRaw"),
		direct.replace("_RequireWorkflowTransactionClient(transactionClient);", ""),
		direct.replace("const client = transactionClient as", "const client = rootClient as"),
		direct.replace("_RequireWorkflowTransactionClient(transactionClient);", "if (false) { _RequireWorkflowTransactionClient(transactionClient); }"),
		direct.replace("return client.$queryRaw", "{ const client = this.rootClient; return client.$queryRaw"),
		direct.replace("async admit(", "async decoy(client: Prisma.TransactionClient) { return client; } async admit(").replace("const client = transactionClient as", "const client = this.rootClient as"),
		direct.replace("return client.$queryRaw", "Reflect.set(transactionClient, \"$\" + \"queryRaw\", Reflect.get(this.rootClient, \"$\" + \"queryRaw\")); return client.$queryRaw"),
		direct.replace("return client.$queryRaw", "Reflect.set(arguments[0], \"$\" + \"queryRaw\", Reflect.get(this.rootClient, \"$\" + \"queryRaw\")); return client.$queryRaw"),
		direct.replace("return client.$queryRaw", "Reflect.set(transactio\\u006eClient, \"$\" + \"queryRaw\", Reflect.get(this.rootClient, \"$\" + \"queryRaw\")); return client.$queryRaw"),
		direct.replace("return client.$queryRaw", "Reflect.set(eval(\"transaction\" + \"Client\"), \"$\" + \"queryRaw\", Reflect.get(this.rootClient, \"$\" + \"queryRaw\")); return client.$queryRaw"),
		direct.replace("return client.$queryRaw", "const rootTag = Reflect.get(this.rootClient, \"$\" + \"queryRaw\").bind(this.rootClient); await rootTag`SELECT dangerous_root_write()`; return client.$queryRaw"),
		direct.replace("return client.$queryRaw", "await Reflect.apply(Reflect.get(this.rootClient, \"$\" + \"queryRawUnsafe\"), this.rootClient, [\"SELECT dangerous_root_write()\"]); return client.$queryRaw"),
		direct.replace("transactionClient: unknown)", "transactionClient: unknown, alias = transactionClient)"),
	];
	assert.equal(_RawProcedureEvidence(direct), _RAW_PROCEDURE_CALL.sqlTemplate);
	for (const mutation of mutations)
	{
		assert.notEqual(_RawProcedureEvidence(mutation), _RAW_PROCEDURE_CALL.sqlTemplate);
	}
	const duplicate = direct.replace("return client.$queryRaw", "client.$queryRaw<readonly unknown[]>`SELECT task_id, run_id, attempt, created FROM absurd.spawn_task(${this.queueName}, ${taskName}, ${input}::jsonb, ${admissionOptions}::jsonb)`; return client.$queryRaw");
	assert.equal(_RawProcedureEvidence(duplicate), undefined);
});

test("accepts only checker-pinned live raw procedure sources", function _AllowsPinnedRawProcedureSources()
{
	const policy = _LivePolicy();
	assert.doesNotThrow(function _ValidLivePolicy() { validatePolicy(policy); });
	for (const procedure of policy.rawProcedureCalls)
	{
		const source = readFileSync(join(_ROOT, procedure.path), "utf8");
		assert.deepEqual(inspectPrismaBoundary(procedure.path, source, [], policy.owners, new Set(), policy.rawProcedureCalls), []);
		assert.deepEqual(validateRawProcedureDeclarations(procedure.path, source, policy.rawProcedureCalls), []);
	}

	const procedure = policy.rawProcedureCalls[0];
	const source = `${readFileSync(join(_ROOT, procedure.path), "utf8")}\n`;
	const coordinatedPin = createHash("sha256").update(source.replace(/\r\n?/gu, "\n")).digest("hex");
	const changedProcedures = [{ ...procedure, sourceSha256: coordinatedPin }, ...policy.rawProcedureCalls.slice(1)];
	assert.throws(function _RejectsCoordinatedPolicyPin() { validatePolicy({ ...policy, rawProcedureCalls: changedProcedures }); }, /invalid raw procedure call/u);
	assert.equal(inspectPrismaBoundary(procedure.path, source, [], policy.owners, new Set(), changedProcedures).some(function _Raw(finding) { return finding.rule === "PRISMA-RAW-QUERY-FORBIDDEN"; }), true);
	assert.equal(validateRawProcedureDeclarations(procedure.path, source, changedProcedures).some(function _Policy(finding) { return finding.rule === "PRISMA-POLICY-RAW-PROCEDURE"; }), true);
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

test("treats a transaction-bound authority like a repository construction", function _AcceptsAuthorityConstruction()
{
	const source = _Fixture("positive-unit-of-work")
		.replaceAll("PrismaWidgetRepository", "PrismaWidgetAuthority")
		.replaceAll("WidgetRepository", "WidgetAuthority");
	const owners = {
		..._OWNERS,
		unitsOfWork: [{
			..._OWNERS.unitsOfWork[0],
			constructs: [{ adapter: "PrismaWidgetAuthority", importPath: "./prisma-widget-repository.js" }],
		}],
	};
	assert.doesNotThrow(function _ValidPolicy() { validatePolicy({ version: 1, owners, rawProcedureCalls: [], exemptions: [] }); });
	const findings = inspectPrismaBoundary("libs/widgets/prisma-widget-unit-of-work.ts", source, ["widget"], owners);
	assert.equal(findings.some(function _Construction(finding) { return finding.rule === "PRISMA-REPOSITORY-CONSTRUCTION" || finding.rule === "PRISMA-POLICY-CONSTRUCTION"; }), false);
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
	const livePolicy = _LivePolicy();
	assert.throws(function _WrongRawProcedureMethod() { validatePolicy({ ...livePolicy, rawProcedureCalls: [{ ...livePolicy.rawProcedureCalls[0], method: "$queryRawUnsafe" }, ...livePolicy.rawProcedureCalls.slice(1)] }); }, /invalid raw procedure call/u);
	assert.throws(function _WrongRawProcedureDigest() { validatePolicy({ ...livePolicy, rawProcedureCalls: [{ ...livePolicy.rawProcedureCalls[0], sourceSha256: "0".repeat(64) }, ...livePolicy.rawProcedureCalls.slice(1)] }); }, /invalid raw procedure call/u);
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
