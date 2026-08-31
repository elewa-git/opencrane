import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { validateRelease } from "../release-versioning-check.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const baselineSql = "-- fixture baseline\nCREATE TABLE example (id integer);\n";
const baselineSha256 = createHash("sha256").update(baselineSql).digest("hex");
const operandImage = `ghcr.io/example/opencrane-postgres:17.5-sha-fixture@sha256:${"a".repeat(64)}`;

function _Manifest(overrides = {})
{
	return {
		repositoryVersion: "0.9.3",
		database: {
			baselinePath: "apps/opencrane/prisma/bootstrap/target-baseline.sql",
			baselineSha256,
			operandImage,
			...overrides.database,
		},
		projects: {
			postgres: { root: "apps/postgres", externalAppVersion: "17" },
			...overrides.projects,
		},
	};
}

function _Workspace({ version = "0.9.3", manifest = _Manifest(), manifestVersion } = {})
{
	const root = mkdtempSync(join(tmpdir(), "release-versioning-"));
	writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", version }));
	mkdirSync(join(root, "releases"), { recursive: true });
	cpSync(join(repositoryRoot, "releases/release-manifest.schema.json"),
		join(root, "releases/release-manifest.schema.json"));
	if (manifest)
		writeFileSync(join(root, `releases/${manifestVersion ?? version}.json`), JSON.stringify(manifest));
	mkdirSync(join(root, "apps/opencrane/prisma/bootstrap"), { recursive: true });
	writeFileSync(join(root, "apps/opencrane/prisma/bootstrap/target-baseline.sql"), baselineSql);
	return root;
}

function _Validate(options)
{
	const root = _Workspace(options);
	try
	{
		return validateRelease(root);
	}
	finally
	{
		rmSync(root, { recursive: true, force: true });
	}
}

test("accepts a coherent current release", function _AcceptsCoherentRelease()
{
	assert.deepEqual(_Validate({}), []);
});

test("the real repository's current release is coherent", function _AcceptsRepositoryRelease()
{
	assert.deepEqual(validateRelease(repositoryRoot), []);
});

test("rejects a non-semver root version", function _RejectsBadRootVersion()
{
	const errors = _Validate({ version: "next" });
	assert.equal(errors.length, 1);
	assert.match(errors[0], /not a strict semantic version/u);
});

test("rejects a missing current release manifest", function _RejectsMissingManifest()
{
	const errors = _Validate({ version: "0.9.4", manifest: null });
	assert.match(errors[0], /releases\/0\.9\.4\.json' does not exist/u);
});

test("rejects a manifest bound to another repository version", function _RejectsVersionMismatch()
{
	const errors = _Validate({ manifest: _Manifest(), manifestVersion: "0.9.4", version: "0.9.4" });
	assert.match(errors.join("\n"), /binds repository version '0\.9\.3', root package\.json says '0\.9\.4'/u);
});

test("rejects a manifest failing the schema", function _RejectsSchemaViolation()
{
	const manifest = _Manifest();
	delete manifest.database.operandImage;
	const errors = _Validate({ manifest });
	assert.match(errors.join("\n"), /schema/u);
});

test("rejects a baseline that drifted from its recorded digest", function _RejectsBaselineDrift()
{
	const manifest = _Manifest({ database: { baselineSha256: "b".repeat(64) } });
	const errors = _Validate({ manifest });
	assert.match(errors.join("\n"), /does not match the recorded digest/u);
});

test("rejects a missing baseline file", function _RejectsMissingBaseline()
{
	const manifest = _Manifest({ database: { baselinePath: "apps/opencrane/prisma/bootstrap/absent.sql" } });
	const errors = _Validate({ manifest });
	assert.match(errors.join("\n"), /does not exist/u);
});

test("rejects an operand tag major that contradicts the declared PostgreSQL major", function _RejectsOperandMajorMismatch()
{
	const manifest = _Manifest({
		projects: { postgres: { root: "apps/postgres", externalAppVersion: "18" } },
	});
	const errors = _Validate({ manifest });
	assert.match(errors.join("\n"), /tag major '17' differs from the chart externalAppVersion '18'/u);
});
