import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	releaseStampComparable,
	__SelectDirectReleaseComparisonBase,
	validateWorkspace,
} from "../release-versioning/core.mjs";
import { validateDatabaseOperand } from "../release-versioning/database-validation.mjs";
import { isAdjacentMinor, isAdjacentPatch, parseSemver, sha256 } from "../release-versioning/version-utils.mjs";

function _WriteJson(path, value)
{
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function _Git(root, args)
{
	const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
	assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
	return result.stdout.trim();
}

function _Fixture({
	adaptedVersion = "0.7.0",
	packageVersion = adaptedVersion,
	actualChartVersion = adaptedVersion,
	repositoryVersion = "0.7.0",
	previousRepositoryVersion = null,
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
			operandImage: "ghcr.io/elewa-git/opencrane-postgres:17.5-sha-qualified@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
			database: { ...manifest.database },
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

test("uses the resolved predecessor reference and the CI base fallback", () =>
{
	assert.equal(__SelectDirectReleaseComparisonBase("guard-base", "0.9.3"), "0.9.3");
	assert.equal(__SelectDirectReleaseComparisonBase("guard-base", null), "guard-base");
});

test("keeps the CLI's direct release diff scoped to the resolved predecessor revision", () =>
{
	const source = readFileSync(join(import.meta.dirname, "../release-versioning-check.mjs"), "utf8");
	assert.match(source, /previousRepositoryCommit/u);
	assert.match(source, /__SelectDirectReleaseComparisonBase\(base, previousReleaseTag \?\? previousRepositoryCommit\)/u);
	assert.match(source, /require-published-predecessor/u);
});

test("fetches release tags before requiring a published predecessor", () =>
{
	const workflow = readFileSync(join(import.meta.dirname, "../../.github/workflows/release.yml"), "utf8");
	assert.match(workflow, /fetch-depth: 0/u);
	assert.match(workflow, /--require-published-predecessor/u);
});

test("permits an untagged predecessor commit in PR validation but requires its tag for release qualification", () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.8.0",
		previousRepositoryVersion: "0.7.0",
		previousSchemaVersion: "0.7.0",
		schemaVersion: "0.7.0",
		adaptedVersion: "0.8.0",
		previousChartVersion: "0.7.0",
	});
	try
	{
		_WriteJson(join(fixture.root, "nx.json"), { plugins: [] });
		_WriteJson(join(fixture.root, "apps/example/project.json"), {
			name: "example",
			projectType: "application",
			root: "apps/example",
			metadata: { release: { adaptedVersion: "0.8.0" } },
		});
		mkdirSync(join(fixture.root, "apps/example/helm/migrations"), { recursive: true });
		_WriteJson(join(fixture.root, "apps/example/helm/migrations/0.7.0-to-0.8.0.json"), {
			fromChartVersion: "0.7.0",
			toChartVersion: "0.8.0",
			kind: "noop",
		});
		mkdirSync(join(fixture.root, "scripts"));
		cpSync(join(import.meta.dirname, "../release-versioning-check.mjs"), join(fixture.root, "scripts/release-versioning-check.mjs"));
		cpSync(join(import.meta.dirname, "../release-versioning"), join(fixture.root, "scripts/release-versioning"), { recursive: true });
		symlinkSync(join(import.meta.dirname, "../../node_modules"), join(fixture.root, "node_modules"));
		_Git(fixture.root, ["init"]);
		_Git(fixture.root, ["config", "user.email", "release-versioning@example.test"]);
		_Git(fixture.root, ["config", "user.name", "Release versioning test"]);
		_Git(fixture.root, ["config", "commit.gpgSign", "false"]);
		_Git(fixture.root, ["add", "."]);
		_Git(fixture.root, ["commit", "-m", "Create the untagged predecessor"]);
		const predecessor = _Git(fixture.root, ["rev-parse", "HEAD"]);
		const manifestPath = join(fixture.root, "releases/0.8.0.json");
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		manifest.previousRepositoryCommit = predecessor;
		_WriteJson(manifestPath, manifest);
		writeFileSync(join(fixture.root, "apps/example/.release-marker"), "candidate\n");
		_Git(fixture.root, ["add", "."]);
		_Git(fixture.root, ["commit", "-m", "Compose the candidate release"]);
		const candidate = _Git(fixture.root, ["rev-parse", "HEAD"]);
		const command = [join(fixture.root, "scripts/release-versioning-check.mjs"), "--base", predecessor];
		const prResult = spawnSync(process.execPath, command, { cwd: fixture.root, encoding: "utf8" });
		assert.equal(prResult.status, 0, `${prResult.stdout}${prResult.stderr}`);
		const qualificationResult = spawnSync(process.execPath, [...command, "--require-published-predecessor"], { cwd: fixture.root, encoding: "utf8" });
		assert.notEqual(qualificationResult.status, 0);
		assert.match(`${qualificationResult.stdout}${qualificationResult.stderr}`, /requires an immutable Git tag/u);
		_Git(fixture.root, ["tag", "0.7.0", predecessor]);
		const taggedQualificationResult = spawnSync(process.execPath, [...command, "--require-published-predecessor"], { cwd: fixture.root, encoding: "utf8" });
		assert.equal(taggedQualificationResult.status, 0, `${taggedQualificationResult.stdout}${taggedQualificationResult.stderr}`);
		_Git(fixture.root, ["tag", "-f", "0.7.0", candidate]);
		const mismatchedTagResult = spawnSync(process.execPath, [...command, "--require-published-predecessor"], { cwd: fixture.root, encoding: "utf8" });
		assert.notEqual(mismatchedTagResult.status, 0);
		assert.match(`${mismatchedTagResult.stdout}${mismatchedTagResult.stderr}`, /does not match previousRepositoryCommit/u);
		_Git(fixture.root, ["tag", "-f", "0.7.0", predecessor]);
		_Git(fixture.root, ["tag", "0.8.0", candidate]);
		const taggedCandidateResult = spawnSync(process.execPath, [...command, "--require-published-predecessor"], { cwd: fixture.root, encoding: "utf8" });
		assert.equal(taggedCandidateResult.status, 0, `${taggedCandidateResult.stdout}${taggedCandidateResult.stderr}`);
		assert.equal(_Git(fixture.root, ["rev-parse", "HEAD"]), candidate);
	}
	finally
	{
		rmSync(fixture.root, { recursive: true, force: true });
	}
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

test("requires a database operand image to use a PostgreSQL-version-prefixed tag plus digest", async () =>
{
	const fixture = _Fixture();
	const manifestPath = join(fixture.root, "releases/0.7.0.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	manifest.database.operandImage = "ghcr.io/elewa-git/opencrane-postgres:0.7.0";
	_WriteJson(manifestPath, manifest);
	const errors = await validateWorkspace(fixture.root, [], fixture.graph);
	assert.ok(errors.some((error) => error.includes("release manifest schema") && error.includes("operandImage")));
});

test("rejects a digest-only database operand that CloudNativePG cannot upgrade", async () =>
{
	const fixture = _Fixture();
	const manifestPath = join(fixture.root, "releases/0.7.0.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	manifest.database.operandImage = "ghcr.io/elewa-git/opencrane-postgres@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
	_WriteJson(manifestPath, manifest);
	const errors = await validateWorkspace(fixture.root, [], fixture.graph);
	assert.ok(errors.some((error) => error.includes("release manifest schema") && error.includes("operandImage")));
});

test("requires the current release manifest to bind a database operand", async () =>
{
	const fixture = _Fixture();
	const manifestPath = join(fixture.root, "releases/0.7.0.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	delete manifest.database.operandImage;
	_WriteJson(manifestPath, manifest);
	const errors = await validateWorkspace(fixture.root, [], fixture.graph);
	assert.ok(errors.includes("current release manifest must bind a PostgreSQL operand image"));
});

test("requires the operand tag major to match the PostgreSQL chart", () =>
{
	const errors = [];
	validateDatabaseOperand({
		database: {
			operandImage: "ghcr.io/elewa-git/opencrane-postgres:16.9-sha-qualified@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		},
		projects: { postgres: { externalAppVersion: "17" } },
	}, errors);
	assert.deepEqual(errors, ["PostgreSQL operand tag major '16' differs from the chart externalAppVersion '17'"]);
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
			operandImage: "ghcr.io/elewa-git/opencrane-postgres:17.5-sha-qualified@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
	assert.deepEqual(await validateWorkspace(fixture.root, [], fixture.graph), []);
});

test("rejects a manual transition without a non-empty review reason", async () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.7.1",
		previousRepositoryVersion: "0.7.0",
		adaptedVersion: "0.7.1",
		manualTransition: { approved: true, reason: "" },
	});
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

test("accepts restoring a historical manifest to its exact tagged bytes", async () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.8.0",
		previousRepositoryVersion: "0.7.0",
		adaptedVersion: "0.8.0",
	});
	const file = "releases/0.7.0.json";
	assert.deepEqual(await validateWorkspace(
		fixture.root,
		[file],
		fixture.graph,
		[],
		[],
		null,
		[file],
		[file],
	), []);
});

test("accepts removing an untagged historical candidate manifest", async () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.8.0",
		previousRepositoryVersion: "0.7.0",
		adaptedVersion: "0.8.0",
	});
	assert.deepEqual(await validateWorkspace(
		fixture.root,
		["releases/0.7.1.json"],
		fixture.graph,
		[],
		[],
		null,
		["releases/0.7.1.json"],
		[],
		["releases/0.7.1.json"],
	), []);
});

test("rejects removing a historical manifest without proof that it is untagged", async () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.8.0",
		previousRepositoryVersion: "0.7.0",
		adaptedVersion: "0.8.0",
	});
	const errors = await validateWorkspace(fixture.root, ["releases/0.7.1.json"], fixture.graph);
	assert.ok(errors.some((error) => error.includes("is immutable")));
});

test("allows a newly introduced historical adoption manifest", async () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.8.0",
		previousRepositoryVersion: "0.7.0",
		adaptedVersion: "0.8.0",
	});
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
	const errors = await validateWorkspace(fixture.root, [], fixture.graph);
	assert.ok(errors.some((error) => error.includes("executable value migrations require an implemented deploy consumer")));
});

test("rejects app and chart version regressions", async () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.8.0",
		previousRepositoryVersion: "0.7.0",
		previousChartVersion: "0.9.0",
		adaptedVersion: "0.8.0",
	});
	const errors = await validateWorkspace(fixture.root, [], fixture.graph);
	assert.ok(errors.some((error) => error.includes("adapted version regresses")));
	assert.ok(errors.some((error) => error.includes("chart version regresses")));
});

test("accepts a changed baseline when the release manifest binds its digest", async () =>
{
	const fixture = _Fixture({
		repositoryVersion: "0.8.0",
		previousRepositoryVersion: "0.7.0",
		adaptedVersion: "0.8.0",
	});
	assert.deepEqual(await validateWorkspace(
		fixture.root,
		["apps/opencrane/prisma/bootstrap/target-baseline.sql"],
		fixture.graph,
	), []);
});
