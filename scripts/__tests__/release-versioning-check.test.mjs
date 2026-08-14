import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	releaseStampComparable,
	validateWorkspace,
} from "../release-versioning/core.mjs";
import { resolveDatabaseTransition } from "../release-versioning/database-validation.mjs";
import { isAdjacentMinor, parseSemver, sha256 } from "../release-versioning/version-utils.mjs";

function _WriteJson(path, value)
{
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function _Fixture({
	adaptedVersion = "0.7.0",
	packageVersion = adaptedVersion,
	actualChartVersion = adaptedVersion,
	repositoryVersion = "0.7.0",
	previousRepositoryVersion = null,
	previousSchemaVersion = previousRepositoryVersion,
	schemaVersion = repositoryVersion,
	previousChartVersion = adaptedVersion,
	adoptionBaseline = previousRepositoryVersion === null,
	manualTransition,
} = {})
{
	const root = mkdtempSync(join(tmpdir(), "opencrane-release-versioning-"));
	mkdirSync(join(root, "apps/example/helm"), { recursive: true });
	mkdirSync(join(root, "apps/opencrane/prisma/bootstrap"), { recursive: true });
	mkdirSync(join(root, "releases"));
	writeFileSync(
		join(root, "releases/release-manifest.schema.json"),
		readFileSync(join(import.meta.dirname, "../../releases/release-manifest.schema.json"), "utf8"),
	);
	_WriteJson(join(root, "package.json"), { version: repositoryVersion });
	_WriteJson(join(root, "apps/example/package.json"), { version: packageVersion });
	writeFileSync(join(root, "apps/example/helm/Chart.yaml"), `apiVersion: v2\nname: example\nversion: ${actualChartVersion}\nappVersion: "${adaptedVersion}"\n`);
	const baselinePath = join(root, "apps/opencrane/prisma/bootstrap/target-baseline.sql");
	writeFileSync(baselinePath, "SELECT 1;\n");
	const manifest = {
		repositoryVersion,
		previousRepositoryVersion,
		adoptionBaseline,
		database: {
			schemaVersion,
			baselinePath: "apps/opencrane/prisma/bootstrap/target-baseline.sql",
			baselineSha256: sha256(baselinePath),
		},
		projects: {
			example: { root: "apps/example", adaptedVersion, chartVersion: adaptedVersion },
		},
	};
	if (manualTransition) manifest.manualTransition = manualTransition;
	_WriteJson(join(root, `releases/${repositoryVersion}.json`), manifest);
	if (previousRepositoryVersion)
	{
		_WriteJson(join(root, `releases/${previousRepositoryVersion}.json`), {
			repositoryVersion: previousRepositoryVersion,
			previousRepositoryVersion: null,
			adoptionBaseline: true,
			database: { ...manifest.database, schemaVersion: previousSchemaVersion },
			projects: {
				example: {
					...manifest.projects.example,
					adaptedVersion: previousChartVersion,
					chartVersion: previousChartVersion,
				},
			},
		});
	}
	const graph = {
		nodes: {
			example: {
				data: {
					projectType: "application",
					root: "apps/example",
					metadata: { release: { adaptedVersion } },
				},
			},
		},
	};
	return { graph, root };
}

function _WriteDatabaseMigration(root, from, to)
{
	const migrationRoot = join(root, `apps/opencrane/prisma/migrations/${from}-to-${to}`);
	mkdirSync(migrationRoot, { recursive: true });
	const sqlPath = join(migrationRoot, "migration.sql");
	writeFileSync(sqlPath, "BEGIN;\nSELECT 1;\nCOMMIT;\n");
	_WriteJson(join(migrationRoot, "manifest.json"), {
		fromSchemaVersion: from,
		toSchemaVersion: to,
		sqlSha256: sha256(sqlPath),
		owner: "apps/opencrane",
		rollback: "backup-restore-or-forward-repair",
		executionMode: "automatic",
		sourceTargetBaselineSha256: sha256(join(root, "apps/opencrane/prisma/bootstrap/target-baseline.sql")),
		targetBaselineSha256: sha256(join(root, "apps/opencrane/prisma/bootstrap/target-baseline.sql")),
		sourceProtectedBaselineSha256: "a".repeat(64),
	});
}

test("accepts only strict semantic versions", () =>
{
	assert.deepEqual(parseSemver("0.7.0"), [0, 7, 0]);
	assert.throws(() => parseSemver("v0.7"), /invalid semantic version/u);
});

test("automatic transitions are adjacent minor trains only", () =>
{
	assert.equal(isAdjacentMinor("0.7.3", "0.8.0"), true);
	assert.equal(isAdjacentMinor("0.7.0", "0.7.1"), false);
	assert.equal(isAdjacentMinor("0.7.0", "1.0.0"), false);
});

test("rejects an invalid Git base instead of suppressing changed files", () =>
{
	const result = spawnSync(
		process.execPath,
		[join(import.meta.dirname, "../release-versioning-check.mjs"), "--base", "definitely-not-a-ref"],
		{ cwd: join(import.meta.dirname, "../.."), encoding: "utf8" },
	);
	assert.notEqual(result.status, 0);
	assert.match(`${result.stdout}${result.stderr}`, /definitely-not-a-ref/u);
});

test("accepts a complete mirrored release fixture", async () =>
{
	const fixture = _Fixture();
	assert.deepEqual(await validateWorkspace(fixture.root, [], fixture.graph), []);
});

test("enforces the declared release-manifest JSON Schema", async () =>
{
	const fixture = _Fixture();
	const manifestPath = join(fixture.root, "releases/0.7.0.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	manifest.undeclaredAuthority = true;
	_WriteJson(manifestPath, manifest);
	const errors = await validateWorkspace(fixture.root, [], fixture.graph);
	assert.ok(errors.some((error) => error.includes("release manifest schema") && error.includes("additional properties")));
});

test("rejects a directly adapted project that retains an older stamp", async () =>
{
	const fixture = _Fixture({ adaptedVersion: "0.6.2" });
	const errors = await validateWorkspace(fixture.root, ["apps/example/src/index.ts"], fixture.graph);
	assert.ok(errors.some((error) => error.includes("direct or dependency change")));
});

test("counts test changes as direct application adaptations", async () =>
{
	const fixture = _Fixture({ adaptedVersion: "0.6.2" });
	const errors = await validateWorkspace(fixture.root, ["apps/example/src/example.test.ts"], fixture.graph);
	assert.ok(errors.some((error) => error.includes("direct or dependency change")));
});

test("uses the Nx dependency graph to stamp apps adapted through a changed library", async () =>
{
	const fixture = _Fixture({ adaptedVersion: "0.6.2" });
	fixture.graph.nodes.contracts = {
		data: { projectType: "library", root: "libs/contracts" },
	};
	fixture.graph.dependencies = {
		example: [{ source: "example", target: "contracts", type: "static" }],
		contracts: [],
	};
	const errors = await validateWorkspace(fixture.root, ["libs/contracts/src/index.ts"], fixture.graph);
	assert.ok(errors.some((error) => error.includes("direct or dependency change")));
});

test("rejects advancing an unaffected application's last-adapted version", async () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.8.0",
		previousRepositoryVersion: "0.7.0",
		adaptedVersion: "0.8.0",
		previousChartVersion: "0.7.0",
	});
	fixture.graph.nodes.untouched = {
		data: {
			projectType: "application",
			root: "apps/untouched",
			metadata: { release: { adaptedVersion: "0.8.0" } },
		},
	};
	const currentPath = join(fixture.root, "releases/0.8.0.json");
	const previousPath = join(fixture.root, "releases/0.7.0.json");
	const current = JSON.parse(readFileSync(currentPath, "utf8"));
	const previous = JSON.parse(readFileSync(previousPath, "utf8"));
	current.projects.untouched = { root: "apps/untouched", adaptedVersion: "0.8.0" };
	previous.projects.untouched = { root: "apps/untouched", adaptedVersion: "0.7.0" };
	_WriteJson(currentPath, current);
	_WriteJson(previousPath, previous);
	_WriteDatabaseMigration(fixture.root, "0.7.0", "0.8.0");
	const errors = await validateWorkspace(fixture.root, ["apps/example/src/index.ts"], fixture.graph);
	assert.ok(errors.some((error) => error.includes("untouched was not adapted")));
});

test("counts package and project configuration as direct adaptations", async () =>
{
	const fixture = _Fixture({ adaptedVersion: "0.6.2" });
	for (const file of ["apps/example/package.json", "apps/example/project.json"])
	{
		const errors = await validateWorkspace(fixture.root, [file], fixture.graph);
		assert.ok(errors.some((error) => error.includes("direct or dependency change")));
	}
});

test("permits package and project stamp-only mirrors", async () =>
{
	const fixture = _Fixture({ adaptedVersion: "0.6.2" });
	const files = ["apps/example/package.json", "apps/example/project.json"];
	assert.deepEqual(await validateWorkspace(fixture.root, files, fixture.graph, files), []);
});

test("treats a semantic root dependency change as an adaptation of every application", async () =>
{
	const fixture = _Fixture({ adaptedVersion: "0.6.2" });
	const errors = await validateWorkspace(fixture.root, ["package.json"], fixture.graph);
	assert.ok(errors.some((error) => error.includes("direct or dependency change")));
});

test("permits root package and lockfile version-only mirrors", async () =>
{
	const fixture = _Fixture({ adaptedVersion: "0.6.2" });
	const files = ["package.json", "package-lock.json"];
	assert.deepEqual(await validateWorkspace(fixture.root, files, fixture.graph, files), []);
});

test("classifies root metadata edits separately from shared dependency changes", () =>
{
	const before = JSON.stringify({ version: "0.7.0", scripts: { test: "old" }, dependencies: { zod: "1" } });
	const metadataOnly = JSON.stringify({ version: "0.8.0", scripts: { test: "new" }, dependencies: { zod: "1" } });
	const dependencyChange = JSON.stringify({ version: "0.8.0", scripts: { test: "new" }, dependencies: { zod: "2" } });
	assert.equal(releaseStampComparable("package.json", before), releaseStampComparable("package.json", metadataOnly));
	assert.notEqual(releaseStampComparable("package.json", before), releaseStampComparable("package.json", dependencyChange));
});

test("ignores workspace version mirrors but retains resolved dependency lock changes", () =>
{
	const before = JSON.stringify({ version: "0.7.0", packages: { "": { version: "0.7.0" }, "apps/a": { version: "0.1.0" }, "node_modules/zod": { version: "1.0.0" } } });
	const mirrors = JSON.stringify({ version: "0.8.0", packages: { "": { version: "0.8.0" }, "apps/a": { version: "0.8.0" }, "node_modules/zod": { version: "1.0.0" } } });
	const dependencyChange = JSON.stringify({ version: "0.8.0", packages: { "": { version: "0.8.0" }, "apps/a": { version: "0.8.0" }, "node_modules/zod": { version: "2.0.0" } } });
	assert.equal(releaseStampComparable("package-lock.json", before), releaseStampComparable("package-lock.json", mirrors));
	assert.notEqual(releaseStampComparable("package-lock.json", before), releaseStampComparable("package-lock.json", dependencyChange));
});

test("rejects release composition changes after the repository version is tagged", async () =>
{
	const fixture = _Fixture();
	const errors = await validateWorkspace(
		fixture.root,
		["apps/example/src/index.ts"],
		fixture.graph,
		[],
		[],
		"v0.7.0",
	);
	assert.ok(errors.some((error) => error.includes("already bound by tag 'v0.7.0'")));
});

test("rejects mutation of the current release manifest after its version is tagged", async () =>
{
	const fixture = _Fixture();
	const errors = await validateWorkspace(
		fixture.root,
		["releases/0.7.0.json"],
		fixture.graph,
		[],
		[],
		"0.7.0",
	);
	assert.ok(errors.some((error) => error.includes("already bound by tag '0.7.0'")));
});

test("rejects package and chart mirror drift", async () =>
{
	const fixture = _Fixture({ packageVersion: "0.6.2", actualChartVersion: "0.6.1" });
	const errors = await validateWorkspace(fixture.root, [], fixture.graph);
	assert.ok(errors.some((error) => error.includes("package.json version")));
	assert.ok(errors.some((error) => error.includes("chart version")));
});

test("rejects stale chart application metadata for a directly adapted app", async () =>
{
	const fixture = _Fixture({ adaptedVersion: "0.7.0" });
	const manifestPath = join(fixture.root, "releases/0.7.0.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	manifest.projects.example.chartAppVersion = "0.1.0";
	_WriteJson(manifestPath, manifest);
	writeFileSync(join(fixture.root, "apps/example/helm/Chart.yaml"), "apiVersion: v2\nname: example\nversion: 0.7.0\nappVersion: \"0.1.0\"\n");
	const errors = await validateWorkspace(fixture.root, ["apps/example/src/index.ts"], fixture.graph);
	assert.ok(errors.some((error) => error.includes("directly adapted but chart appVersion")));
});

test("rejects a checked-in dependency archive that differs from chart source", async () =>
{
	const root = mkdtempSync(join(tmpdir(), "opencrane-release-packaging-"));
	mkdirSync(join(root, "apps/example/helm/templates"), { recursive: true });
	mkdirSync(join(root, "apps/_infra/deploy-k8s"), { recursive: true });
	mkdirSync(join(root, "apps/opencrane/prisma/bootstrap"), { recursive: true });
	mkdirSync(join(root, "releases"));
	writeFileSync(
		join(root, "releases/release-manifest.schema.json"),
		readFileSync(join(import.meta.dirname, "../../releases/release-manifest.schema.json"), "utf8"),
	);
	_WriteJson(join(root, "package.json"), { version: "0.7.0" });
	writeFileSync(join(root, "apps/example/helm/Chart.yaml"), "apiVersion: v2\nname: example\ntype: application\nversion: 0.7.0\nappVersion: \"0.7.0\"\n");
	writeFileSync(join(root, "apps/example/helm/values.yaml"), "replicas: 1\n");
	writeFileSync(join(root, "apps/example/helm/templates/configmap.yaml"), "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: example\n");
	writeFileSync(join(root, "apps/_infra/deploy-k8s/Chart.yaml"), [
		"apiVersion: v2",
		"name: umbrella",
		"type: application",
		"version: 0.7.0",
		"appVersion: \"0.7.0\"",
		"dependencies:",
		"  - name: example",
		"    version: 0.7.0",
		"    repository: file://../../example/helm",
		"",
	].join("\n"));
	const dependencyResult = spawnSync("helm", ["dependency", "update", "apps/_infra/deploy-k8s"], {
		cwd: root,
		encoding: "utf8",
	});
	assert.equal(dependencyResult.status, 0, dependencyResult.stderr);
	const baselinePath = join(root, "apps/opencrane/prisma/bootstrap/target-baseline.sql");
	writeFileSync(baselinePath, "SELECT 1;\n");
	_WriteJson(join(root, "releases/0.7.0.json"), {
		repositoryVersion: "0.7.0",
		previousRepositoryVersion: null,
		adoptionBaseline: true,
		database: {
			schemaVersion: "0.7.0",
			baselinePath: "apps/opencrane/prisma/bootstrap/target-baseline.sql",
			baselineSha256: sha256(baselinePath),
		},
		projects: {
			"deploy-k8s": { root: "apps/_infra/deploy-k8s", adaptedVersion: "0.7.0", chartVersion: "0.7.0" },
			example: { root: "apps/example", adaptedVersion: "0.7.0", chartVersion: "0.7.0" },
		},
	});
	writeFileSync(join(root, "apps/example/helm/values.yaml"), "replicas: 2\n");
	const graph = {
		nodes: {
			"deploy-k8s": { data: { projectType: "application", root: "apps/_infra/deploy-k8s", metadata: { release: { adaptedVersion: "0.7.0" } } } },
			example: { data: { projectType: "application", root: "apps/example", metadata: { release: { adaptedVersion: "0.7.0" } } } },
		},
	};
	const errors = await validateWorkspace(root, [], graph);
	assert.ok(errors.some((error) => error.includes("differs from source")));
});

test("rejects baseline changes inside an already adopted train", async () =>
{
	const fixture = _Fixture();
	const errors = await validateWorkspace(
		fixture.root,
		["apps/opencrane/prisma/bootstrap/target-baseline.sql"],
		fixture.graph,
	);
	assert.ok(errors.some((error) => error.includes("bump the root minor version")));
});

test("rejects chart behavior changes inside an already adopted train", async () =>
{
	const fixture = _Fixture();
	const errors = await validateWorkspace(
		fixture.root,
		["apps/example/helm/templates/deployment.yaml"],
		fixture.graph,
	);
	assert.ok(errors.some((error) => error.includes("add a Helm transition")));
});

test("requires explicit approval for non-minor transitions", async () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.7.1",
		previousRepositoryVersion: "0.7.0",
		adaptedVersion: "0.7.1",
	});
	const errors = await validateWorkspace(fixture.root, [], fixture.graph);
	assert.ok(errors.some((error) => error.includes("manualTransition")));
});

test("accepts an explicitly approved manual transition", async () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.7.1",
		previousRepositoryVersion: "0.7.0",
		adaptedVersion: "0.7.1",
		manualTransition: { approved: true, reason: "Operator-reviewed patch transition" },
	});
	_WriteDatabaseMigration(fixture.root, "0.7.0", "0.7.1");
	assert.deepEqual(await validateWorkspace(fixture.root, [], fixture.graph), []);
});

test("resolves an approved patch release with unchanged database state as current", () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.7.1",
		previousRepositoryVersion: "0.7.0",
		previousSchemaVersion: "0.7.0",
		schemaVersion: "0.7.0",
		adaptedVersion: "0.7.1",
		manualTransition: { approved: true, reason: "Operator-reviewed patch transition" },
	});
	const transition = resolveDatabaseTransition(fixture.root, "0.7.1", "0.7.0");
	assert.equal(transition.kind, "current");
	assert.equal(transition.targetSchemaVersion, "0.7.0");
	assert.equal(transition.migration, null);
});

test("rejects a manual transition without a non-empty review reason", async () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.7.1",
		previousRepositoryVersion: "0.7.0",
		adaptedVersion: "0.7.1",
		manualTransition: { approved: true, reason: "" },
	});
	_WriteDatabaseMigration(fixture.root, "0.7.0", "0.7.1");
	const errors = await validateWorkspace(fixture.root, [], fixture.graph);
	assert.ok(errors.some((error) => error.includes("non-empty reason")));
});

test("rejects rewriting an older release manifest", async () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.8.0",
		previousRepositoryVersion: "0.7.0",
		adaptedVersion: "0.8.0",
	});
	const errors = await validateWorkspace(fixture.root, ["releases/0.7.0.json"], fixture.graph);
	assert.ok(errors.some((error) => error.includes("is immutable")));
});

test("allows a newly introduced historical adoption manifest", async () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.8.0",
		previousRepositoryVersion: "0.7.0",
		adaptedVersion: "0.8.0",
	});
	_WriteDatabaseMigration(fixture.root, "0.7.0", "0.8.0");
	const file = "releases/0.7.0.json";
	assert.deepEqual(await validateWorkspace(fixture.root, [file], fixture.graph, [], [file]), []);
});

test("accepts an unchanged adoption manifest from the cumulative release-train diff", async () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.8.0",
		previousRepositoryVersion: "0.7.0",
		adaptedVersion: "0.8.0",
	});
	_WriteDatabaseMigration(fixture.root, "0.7.0", "0.8.0");
	assert.deepEqual(await validateWorkspace(
		fixture.root,
		["releases/0.7.0.json"],
		fixture.graph,
		[],
		[],
		null,
		[],
	), []);
});

test("rejects an unrelated newly introduced historical manifest", async () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.8.0",
		previousRepositoryVersion: "0.7.0",
		adaptedVersion: "0.8.0",
	});
	_WriteDatabaseMigration(fixture.root, "0.7.0", "0.8.0");
	const file = "releases/0.6.0.json";
	_WriteJson(join(fixture.root, file), {
		repositoryVersion: "0.6.0",
		previousRepositoryVersion: null,
		adoptionBaseline: true,
	});
	const errors = await validateWorkspace(fixture.root, [file], fixture.graph, [], [file]);
	assert.ok(errors.some((error) => error.includes("exact predecessor")));
});

test("requires a Helm transition from the previous chart version", async () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.8.0",
		previousRepositoryVersion: "0.7.0",
		previousChartVersion: "0.6.2",
		adaptedVersion: "0.8.0",
	});
	const errors = await validateWorkspace(
		fixture.root,
		["apps/example/helm/templates/deployment.yaml"],
		fixture.graph,
	);
	assert.ok(errors.some((error) => error.includes("0.6.2-to-0.8.0.json")));
});

test("requires a Helm transition even when the current diff omits chart files", async () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.8.0",
		previousRepositoryVersion: "0.7.0",
		previousChartVersion: "0.6.2",
		adaptedVersion: "0.8.0",
	});
	const errors = await validateWorkspace(fixture.root, [], fixture.graph);
	assert.ok(errors.some((error) => error.includes("0.6.2-to-0.8.0.json")));
});

test("rejects chart behavior changes without a chart version advance", async () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.8.0",
		previousRepositoryVersion: "0.7.0",
		adaptedVersion: "0.8.0",
	});
	const errors = await validateWorkspace(
		fixture.root,
		["apps/example/helm/templates/deployment.yaml"],
		fixture.graph,
	);
	assert.ok(errors.some((error) => error.includes("without advancing chart version")));
});

test("accepts an exact no-op Helm transition", async () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.8.0",
		previousRepositoryVersion: "0.7.0",
		previousChartVersion: "0.6.2",
		adaptedVersion: "0.8.0",
	});
	const migrationRoot = join(fixture.root, "apps/example/helm/migrations");
	mkdirSync(migrationRoot, { recursive: true });
	_WriteJson(join(migrationRoot, "0.6.2-to-0.8.0.json"), {
		fromChartVersion: "0.6.2",
		toChartVersion: "0.8.0",
		kind: "noop",
	});
	_WriteDatabaseMigration(fixture.root, "0.7.0", "0.8.0");
	assert.deepEqual(await validateWorkspace(
		fixture.root,
		["apps/example/helm/templates/deployment.yaml"],
		fixture.graph,
	), []);
});

test("rejects Helm value patches until deployment has an executable consumer", async () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.8.0",
		previousRepositoryVersion: "0.7.0",
		previousChartVersion: "0.6.2",
		adaptedVersion: "0.8.0",
	});
	const migrationRoot = join(fixture.root, "apps/example/helm/migrations");
	mkdirSync(migrationRoot, { recursive: true });
	_WriteJson(join(migrationRoot, "0.6.2-to-0.8.0.json"), {
		fromChartVersion: "0.6.2",
		toChartVersion: "0.8.0",
		kind: "json-patch",
		patch: [{ op: "remove", path: "/retiredValue" }],
	});
	_WriteDatabaseMigration(fixture.root, "0.7.0", "0.8.0");
	const errors = await validateWorkspace(fixture.root, [], fixture.graph);
	assert.ok(errors.some((error) => error.includes("executable value migrations require an implemented deploy consumer")));
});

test("requires a reviewed database migration for a new minor train", async () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.8.0",
		previousRepositoryVersion: "0.7.0",
		previousSchemaVersion: "0.5.8",
		adaptedVersion: "0.8.0",
	});
	const errors = await validateWorkspace(
		fixture.root,
		["apps/opencrane/prisma/bootstrap/target-baseline.sql"],
		fixture.graph,
	);
	assert.ok(errors.some((error) => error.includes("0.5.8-to-0.8.0")));
});

test("requires a database migration even when the current diff omits the baseline", async () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.8.0",
		previousRepositoryVersion: "0.7.0",
		previousSchemaVersion: "0.5.8",
		adaptedVersion: "0.8.0",
	});
	const errors = await validateWorkspace(fixture.root, [], fixture.graph);
	assert.ok(errors.some((error) => error.includes("0.5.8-to-0.8.0")));
});

test("rejects app, chart, and database version regressions", async () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.8.0",
		previousRepositoryVersion: "0.7.0",
		previousSchemaVersion: "0.9.0",
		previousChartVersion: "0.9.0",
		adaptedVersion: "0.8.0",
	});
	const errors = await validateWorkspace(fixture.root, [], fixture.graph);
	assert.ok(errors.some((error) => error.includes("adapted version regresses")));
	assert.ok(errors.some((error) => error.includes("chart version regresses")));
	assert.ok(errors.some((error) => error.includes("schema version regresses")));
});

test("accepts a digest-bound migration from the previous schema version", async () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.8.0",
		previousRepositoryVersion: "0.7.0",
		previousSchemaVersion: "0.5.8",
		adaptedVersion: "0.8.0",
	});
	_WriteDatabaseMigration(fixture.root, "0.5.8", "0.8.0");
	assert.deepEqual(await validateWorkspace(
		fixture.root,
		["apps/opencrane/prisma/bootstrap/target-baseline.sql"],
		fixture.graph,
	), []);
});
