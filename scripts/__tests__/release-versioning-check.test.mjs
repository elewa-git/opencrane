import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	releaseStampComparable,
	__SelectDirectReleaseComparisonBase,
	validateWorkspace,
} from "../release-versioning/core.mjs";
import { resolveDatabaseTransition, resolveSchemaLineage } from "../release-versioning/database-validation.mjs";
import { isAdjacentMinor, isAdjacentPatch, parseSemver, sha256 } from "../release-versioning/version-utils.mjs";

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
	const sourceBaselineSha256 = sha256(join(root, "apps/opencrane/prisma/bootstrap/target-baseline.sql"));
	_WriteJson(join(migrationRoot, "manifest.json"), {
		fromSchemaVersion: from,
		toSchemaVersion: to,
		sqlSha256: sha256(sqlPath),
		owner: "apps/opencrane",
		rollback: "backup-restore-or-forward-repair",
		executionMode: "automatic",
		sourceTargetBaselineSha256: sourceBaselineSha256,
		targetBaselineSha256: sourceBaselineSha256,
		sourceProtectedBaselineSha256: "a".repeat(64),
	});
}

function _CarryForwardFixture()
{
	const fixture = _Fixture({
		repositoryVersion: "0.9.1",
		previousRepositoryVersion: "0.9.0",
		previousSchemaVersion: "0.9.0",
		schemaVersion: "0.9.0",
		adaptedVersion: "0.9.1",
		previousChartVersion: "0.9.0",
		manualTransition: { approved: true, reason: "Carry the failed predecessor migration through its repair patch" },
	});
	const targetPath = join(fixture.root, "releases/0.9.1.json");
	const target = JSON.parse(readFileSync(targetPath, "utf8"));
	target.database.carriedForwardFromRepositoryVersion = "0.8.1";
	_WriteJson(targetPath, target);
	const ownerPath = join(fixture.root, "releases/0.9.0.json");
	const owner = JSON.parse(readFileSync(ownerPath, "utf8"));
	owner.previousRepositoryVersion = "0.8.1";
	owner.adoptionBaseline = false;
	_WriteJson(ownerPath, owner);
	_WriteJson(join(fixture.root, "releases/0.8.1.json"), {
		...owner,
		repositoryVersion: "0.8.1",
		previousRepositoryVersion: null,
		adoptionBaseline: true,
		database: { ...owner.database, schemaVersion: "0.8.0" },
	});
	_WriteDatabaseMigration(fixture.root, "0.8.0", "0.9.0");
	return fixture;
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

test("patch adjacency stays inside one minor train", () =>
{
	assert.equal(isAdjacentPatch("0.9.0", "0.9.1"), true);
	assert.equal(isAdjacentPatch("0.8.1", "0.9.0"), false);
	assert.equal(isAdjacentPatch("0.9.0", "0.9.2"), false);
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

test("scopes current release ownership to its declared predecessor", () =>
{
	assert.equal(__SelectDirectReleaseComparisonBase("0.9.0", "0.9.1"), "0.9.1");
	assert.equal(__SelectDirectReleaseComparisonBase("0.9.1", null), "0.9.1");
});

test("keeps the CLI's direct release diff scoped to the declared predecessor", () =>
{
	const source = readFileSync(join(import.meta.dirname, "../release-versioning-check.mjs"), "utf8");
	assert.match(source, /_ChangedFiles\(\[__SelectDirectReleaseComparisonBase\(base, versionBase\)\]\)/u);
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
	assert.ok(errors.some((error) => error.includes("changed directly")));
});

test("counts test changes as direct application adaptations", async () =>
{
	const fixture = _Fixture({ adaptedVersion: "0.6.2" });
	const errors = await validateWorkspace(fixture.root, ["apps/example/src/example.test.ts"], fixture.graph);
	assert.ok(errors.some((error) => error.includes("changed directly")));
});

test("keeps an application's stamp when only a depended-on library changed", async () =>
{
	const fixture = _Fixture({ adaptedVersion: "0.6.2" });
	fixture.graph.nodes.contracts = {
		data: { projectType: "library", root: "libs/contracts" },
	};
	fixture.graph.dependencies = {
		example: [{ source: "example", target: "contracts", type: "static" }],
		contracts: [],
	};
	assert.deepEqual(await validateWorkspace(fixture.root, ["libs/contracts/src/index.ts"], fixture.graph), []);
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
		assert.ok(errors.some((error) => error.includes("changed directly")));
	}
});

test("permits package and project stamp-only mirrors", async () =>
{
	const fixture = _Fixture({ adaptedVersion: "0.6.2" });
	const files = ["apps/example/package.json", "apps/example/project.json"];
	assert.deepEqual(await validateWorkspace(fixture.root, files, fixture.graph, files), []);
});

test("keeps every application's stamp when only the root dependency set changed", async () =>
{
	const fixture = _Fixture({ adaptedVersion: "0.6.2" });
	assert.deepEqual(await validateWorkspace(fixture.root, ["package.json"], fixture.graph), []);
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

test("ignores tagged composition changes that predate the candidate diff", async () =>
{
	const fixture = _Fixture();
	const errors = await validateWorkspace(
		fixture.root,
		["apps/example/src/index.ts"],
		fixture.graph,
		[],
		[],
		"v0.7.0",
		[],
	);
	assert.ok(!errors.some((error) => error.includes("already bound by tag 'v0.7.0'")));
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

test("requires the umbrella to declare every chart-bearing application", async () =>
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
	const declaredUmbrella = [
		"apiVersion: v2",
		"name: umbrella",
		"type: application",
		"version: 0.7.0",
		"appVersion: \"0.7.0\"",
		"dependencies:",
		"  - name: example",
		"    version: \">=0.0.0-0\"",
		"    repository: file://../../example/helm",
		"",
	].join("\n");
	writeFileSync(join(root, "apps/_infra/deploy-k8s/Chart.yaml"), declaredUmbrella);
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
	const graph = {
		nodes: {
			"deploy-k8s": { data: { projectType: "application", root: "apps/_infra/deploy-k8s", metadata: { release: { adaptedVersion: "0.7.0" } } } },
			example: { data: { projectType: "application", root: "apps/example", metadata: { release: { adaptedVersion: "0.7.0" } } } },
		},
	};
	// A declared dependency needs no lock file or vendored archive: the in-repo sources are the
	// version authority and packaging is derived at render time.
	assert.deepEqual(await validateWorkspace(root, [], graph), []);
	writeFileSync(join(root, "apps/_infra/deploy-k8s/Chart.yaml"), declaredUmbrella.replace(/dependencies:[\s\S]*$/u, ""));
	const missing = await validateWorkspace(root, [], graph);
	assert.ok(missing.some((error) => error.includes("does not declare dependency example")));
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

test("carries one failed predecessor migration through its immediate repair patch", () =>
{
	const fixture = _CarryForwardFixture();
	const transition = resolveDatabaseTransition(fixture.root, "0.9.1", "0.8.1");
	assert.equal(transition.kind, "migration");
	assert.equal(transition.targetSchemaVersion, "0.9.0");
	assert.equal(transition.migration.id, "0.8.0-to-0.9.0");
	assert.equal(transition.migration.carriedForwardThroughReleaseVersion, "0.9.0");
	assert.equal(resolveDatabaseTransition(fixture.root, "0.9.1", "0.9.0").kind, "current");
	assert.equal(resolveDatabaseTransition(fixture.root, "0.9.1", "0.9.1").kind, "current");
});

test("recovers the migration that produced the schema for a same-schema release", () =>
{
	const fixture = _CarryForwardFixture();
	// 0.9.1 changes no schema of its own, but a live database that reached 0.9.0 through the real
	// 0.8.0-to-0.9.0 migration still records it, and privilege reconciliation compares against it.
	assert.equal(resolveDatabaseTransition(fixture.root, "0.9.1", "0.9.0").migration, null);
	const lineage = resolveSchemaLineage(fixture.root, "0.9.1");
	assert.equal(lineage.id, "0.8.0-to-0.9.0");
	assert.equal(lineage.fromSchemaVersion, "0.8.0");
	assert.equal(lineage.toSchemaVersion, "0.9.0");
	assert.equal(lineage.ownedByReleaseVersion, "0.9.0");
	// Reporting history must not authorise a carry-forward override.
	assert.equal(lineage.carriedForwardThroughReleaseVersion, null);
	assert.ok(lineage.sqlSha256);
	assert.ok(Array.isArray(lineage.sourceProtectedBaselineSha256s));
	assert.ok(lineage.sourceProtectedBaselineSha256s.length > 0);
});

test("reports no lineage for a schema that was never migrated into", () =>
{
	const fixture = _Fixture();
	assert.equal(resolveSchemaLineage(fixture.root, "0.7.0"), null);
});

test("rejects undeclared and altered database carry-forward transitions", () =>
{
	const undeclared = _CarryForwardFixture();
	const undeclaredPath = join(undeclared.root, "releases/0.9.1.json");
	const undeclaredTarget = JSON.parse(readFileSync(undeclaredPath, "utf8"));
	delete undeclaredTarget.database.carriedForwardFromRepositoryVersion;
	_WriteJson(undeclaredPath, undeclaredTarget);
	assert.throws(
		() => resolveDatabaseTransition(undeclared.root, "0.9.1", "0.8.1"),
		/exact previous release/u,
	);

	const altered = _CarryForwardFixture();
	const alteredPath = join(altered.root, "releases/0.9.1.json");
	const alteredTarget = JSON.parse(readFileSync(alteredPath, "utf8"));
	alteredTarget.database.schemaVersion = "0.9.1";
	_WriteJson(alteredPath, alteredTarget);
	assert.throws(
		() => resolveDatabaseTransition(altered.root, "0.9.1", "0.8.1"),
		/preserve the predecessor database identity/u,
	);

	const wrongSource = _CarryForwardFixture();
	assert.throws(
		() => resolveDatabaseTransition(wrongSource.root, "0.9.1", "0.7.0"),
		/source release manifest is missing|exact previous release/u,
	);
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

test("normalizes a historical singular protected source digest for deployment", () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.8.0",
		previousRepositoryVersion: "0.7.0",
		previousSchemaVersion: "0.7.0",
		adaptedVersion: "0.8.0",
	});
	_WriteDatabaseMigration(fixture.root, "0.7.0", "0.8.0");
	const transition = resolveDatabaseTransition(fixture.root, "0.8.0", "0.7.0");
	assert.notEqual(transition.migration.freshSourceProtectedBaselineSha256, transition.migration.sourceTargetBaselineSha256);
	assert.deepEqual(transition.migration.sourceProtectedBaselineSha256s, ["a".repeat(64)]);
	assert.equal(transition.migration.freshSourceProtectedBaselineSha256, "a".repeat(64));
});

test("accepts several unique protected source origins and preserves their order", async () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.8.0",
		previousRepositoryVersion: "0.7.0",
		previousSchemaVersion: "0.7.0",
		adaptedVersion: "0.8.0",
	});
	_WriteDatabaseMigration(fixture.root, "0.7.0", "0.8.0");
	const manifestPath = join(fixture.root, "apps/opencrane/prisma/migrations/0.7.0-to-0.8.0/manifest.json");
	const migrationManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	const inheritedOrigin = "b".repeat(64);
	const freshOrigin = "c".repeat(64);
	delete migrationManifest.sourceProtectedBaselineSha256;
	migrationManifest.sourceProtectedBaselineSha256s = [inheritedOrigin, freshOrigin];
	migrationManifest.freshSourceProtectedBaselineSha256 = freshOrigin;
	_WriteJson(manifestPath, migrationManifest);
	assert.deepEqual(await validateWorkspace(fixture.root, [], fixture.graph), []);
	const transition = resolveDatabaseTransition(fixture.root, "0.8.0", "0.7.0");
	assert.deepEqual(transition.migration.sourceProtectedBaselineSha256s, [inheritedOrigin, freshOrigin]);
	assert.equal(transition.migration.freshSourceProtectedBaselineSha256, freshOrigin);
});

test("rejects a raw source baseline mislabeled as the fresh protected origin", async () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.8.0",
		previousRepositoryVersion: "0.7.0",
		previousSchemaVersion: "0.7.0",
		adaptedVersion: "0.8.0",
	});
	_WriteDatabaseMigration(fixture.root, "0.7.0", "0.8.0");
	const manifestPath = join(fixture.root, "apps/opencrane/prisma/migrations/0.7.0-to-0.8.0/manifest.json");
	const migrationManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	delete migrationManifest.sourceProtectedBaselineSha256;
	migrationManifest.sourceProtectedBaselineSha256s = [migrationManifest.sourceTargetBaselineSha256];
	migrationManifest.freshSourceProtectedBaselineSha256 = migrationManifest.sourceTargetBaselineSha256;
	_WriteJson(manifestPath, migrationManifest);
	const errors = await validateWorkspace(fixture.root, [], fixture.graph);
	assert.ok(errors.some((error) => error.includes("bootstrap envelope")));
});

test("derives the exact admitted history prefix for an inherited protected origin", () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.9.0",
		previousRepositoryVersion: "0.8.0",
		previousSchemaVersion: "0.8.0",
		adaptedVersion: "0.9.0",
	});
	const sourceReleasePath = join(fixture.root, "releases/0.8.0.json");
	const sourceRelease = JSON.parse(readFileSync(sourceReleasePath, "utf8"));
	sourceRelease.previousRepositoryVersion = "0.7.0";
	sourceRelease.adoptionBaseline = false;
	_WriteJson(sourceReleasePath, sourceRelease);
	_WriteJson(join(fixture.root, "releases/0.7.0.json"), {
		...sourceRelease,
		repositoryVersion: "0.7.0",
		previousRepositoryVersion: null,
		adoptionBaseline: true,
		database: { ...sourceRelease.database, schemaVersion: "0.7.0" },
	});
	_WriteDatabaseMigration(fixture.root, "0.7.0", "0.8.0");
	const inheritedOrigin = "b".repeat(64);
	const olderManifestPath = join(fixture.root, "apps/opencrane/prisma/migrations/0.7.0-to-0.8.0/manifest.json");
	const olderManifest = JSON.parse(readFileSync(olderManifestPath, "utf8"));
	olderManifest.sourceProtectedBaselineSha256 = inheritedOrigin;
	_WriteJson(olderManifestPath, olderManifest);
	_WriteDatabaseMigration(fixture.root, "0.8.0", "0.9.0");
	const currentManifestPath = join(fixture.root, "apps/opencrane/prisma/migrations/0.8.0-to-0.9.0/manifest.json");
	const currentManifest = JSON.parse(readFileSync(currentManifestPath, "utf8"));
	const freshOrigin = "c".repeat(64);
	delete currentManifest.sourceProtectedBaselineSha256;
	currentManifest.sourceProtectedBaselineSha256s = [freshOrigin, inheritedOrigin];
	currentManifest.freshSourceProtectedBaselineSha256 = freshOrigin;
	_WriteJson(currentManifestPath, currentManifest);
	const transition = resolveDatabaseTransition(fixture.root, "0.9.0", "0.8.0");
	assert.deepEqual(transition.migration.sourceHistoryLineages, [
		{ sourceProtectedBaselineSha256: freshOrigin, history: [] },
		{
			sourceProtectedBaselineSha256: inheritedOrigin,
			history: [{
				schemaVersion: "0.8.0",
				sourceSchemaVersion: "0.7.0",
				sourceProtectedBaselineSha256: inheritedOrigin,
				targetBaselineSha256: sourceRelease.database.baselineSha256,
				migrationId: "0.7.0-to-0.8.0",
				sqlSha256: olderManifest.sqlSha256,
			}],
		},
	]);
});
