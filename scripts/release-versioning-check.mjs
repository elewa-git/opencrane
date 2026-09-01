#!/usr/bin/env node
// Pre-1.0 release check. One current release manifest must bind the repository version, the
// fresh-install database baseline, and the PostgreSQL operand image — the three things
// deployment actually consumes. There are no version-to-version upgrade contracts, chart
// version stamps, or manifest immutability rules until the MVP release
// (see docs/agents/versioning.md and docs/agents/deploy-ledger.md, 2026-08-31).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createReleaseManifestValidator } from "./release-versioning/manifest-validation.mjs";
import { parseSemver, readJson, sha256 } from "./release-versioning/version-utils.mjs";

/**
 * Checks that the current release binds a PostgreSQL operand whose tag exposes its version and
 * whose digest fixes its bytes.
 *
 * CNPG reads the PostgreSQL major version from the tag before it decides how to upgrade. When the
 * release declares the PostgreSQL chart's external major, the two versions must agree or CNPG
 * would make that decision from false metadata.
 *
 * Called by: {@link validateRelease}.
 * @param manifest - Current release manifest whose PostgreSQL operand will be deployed.
 * @param errors - Validation errors collected for the caller to report together.
 * @see https://cloudnative-pg.io/docs/1.27/container_images/#image-tag-requirements
 */
export function validateDatabaseOperand(manifest, errors)
{
	const operandImage = manifest.database?.operandImage;
	if (!operandImage)
	{
		errors.push("current release manifest must bind a PostgreSQL operand image");
		return;
	}
	const tagMajor = /:(?<major>[0-9]+)(?:\.[0-9]+)*(?:[-_.][A-Za-z0-9_.-]+)?@sha256:/u.exec(operandImage)?.groups?.major;
	if (!tagMajor) return;
	const expectedMajor = manifest.projects?.postgres?.externalAppVersion;
	if (expectedMajor && tagMajor !== expectedMajor)
		errors.push(`PostgreSQL operand tag major '${tagMajor}' differs from the chart externalAppVersion '${expectedMajor}'`);
}

/**
 * Checks that the fresh-install authority the manifest names exists and still matches its
 * recorded digest, so a deploy renders exactly the baseline the release reviewed.
 *
 * Called by: {@link validateRelease}.
 * @param repositoryRoot - Absolute path of the repository the manifest describes.
 * @param manifest - Current release manifest naming the baseline.
 * @param errors - Validation errors collected for the caller to report together.
 */
export function validateDatabaseBaseline(repositoryRoot, manifest, errors)
{
	const database = manifest.database ?? {};
	if (!database.baselinePath || !database.baselineSha256)
	{
		errors.push("current release manifest must record the database baseline path and digest");
		return;
	}
	const baselinePath = join(repositoryRoot, database.baselinePath);
	if (!existsSync(baselinePath))
	{
		errors.push(`database baseline '${database.baselinePath}' does not exist`);
		return;
	}
	if (sha256(baselinePath) !== database.baselineSha256)
		errors.push(`database baseline '${database.baselinePath}' does not match the recorded digest — update database.baselineSha256 in the release manifest`);
}

/**
 * Runs every pre-1.0 release rule against one repository checkout and returns the failures.
 *
 * Called by: this file's CLI entry and `scripts/__tests__/release-versioning-check.test.mjs`.
 * @param repositoryRoot - Absolute path of the repository checkout to validate.
 * @returns Human-readable validation errors; empty when the release is coherent.
 */
export function validateRelease(repositoryRoot)
{
	const errors = [];
	const rootVersion = readJson(join(repositoryRoot, "package.json")).version;
	try
	{
		parseSemver(rootVersion);
	}
	catch
	{
		errors.push(`root package.json version '${rootVersion}' is not a strict semantic version`);
		return errors;
	}
	const manifestPath = join(repositoryRoot, "releases", `${rootVersion}.json`);
	if (!existsSync(manifestPath))
	{
		errors.push(`release manifest 'releases/${rootVersion}.json' does not exist for the root package.json version`);
		return errors;
	}
	const manifest = readJson(manifestPath);
	errors.push(...createReleaseManifestValidator(repositoryRoot)(manifest, `releases/${rootVersion}.json`));
	if (manifest.repositoryVersion !== rootVersion)
		errors.push(`release manifest binds repository version '${manifest.repositoryVersion}', root package.json says '${rootVersion}'`);
	validateDatabaseBaseline(repositoryRoot, manifest, errors);
	validateDatabaseOperand(manifest, errors);
	return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
{
	const errors = validateRelease(process.cwd());
	if (errors.length > 0)
	{
		for (const error of errors) console.error(`release-versioning: ${error}`);
		process.exit(1);
	}
	console.log("release-versioning: current release manifest is coherent.");
}
