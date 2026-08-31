import { existsSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "./version-utils.mjs";

const operandImagePattern = /:[0-9]+(?:\.[0-9]+)*(?:[-_.][A-Za-z0-9_.-]+)?@sha256:[a-f0-9]{64}$/u;

/**
 * Checks that the release names a PostgreSQL image whose tag matches the chart's engine version.
 *
 * Release-manifest validation checks the tag and digest shape first. CloudNativePG then reads the
 * major version from that tag when it decides how to upgrade, while the digest pins the image bytes.
 * Called by: `validateWorkspace`.
 * @param manifest - Release manifest whose PostgreSQL image will be deployed.
 * @param errors - Validation errors collected for the caller to report together.
 * @see https://cloudnative-pg.io/docs/1.27/container_images/#image-tag-requirements
 */
export function validateDatabaseOperand(manifest, errors)
{
	const operandImage = manifest.database.operandImage;
	if (!operandImage)
	{
		errors.push("current release manifest must bind a PostgreSQL operand image");
		return;
	}
	if (!operandImagePattern.test(operandImage)) return;
	const expectedMajor = manifest.projects.postgres?.externalAppVersion;
	if (!expectedMajor) return;
	const tagMajor = /:(?<major>[0-9]+)(?:\.[0-9]+)*(?:[-_.][A-Za-z0-9_.-]+)?@sha256:/u.exec(operandImage)?.groups?.major;
	if (tagMajor !== expectedMajor)
		errors.push(`PostgreSQL operand tag major '${tagMajor}' differs from the chart externalAppVersion '${expectedMajor}'`);
}

/**
 * Checks that the fresh-install database baseline exists and matches the digest in the release.
 * This prevents a fresh install from using schema bytes other than the ones reviewed for that release.
 * Called by: `validateWorkspace`.
 * @param repositoryRoot - Repository root holding the baseline.
 * @param manifest - Release manifest that records the baseline path and digest.
 * @param errors - Validation errors collected for the caller to report together.
 */
export function validateDatabase(repositoryRoot, manifest, errors)
{
	const database = manifest.database;
	const baselinePath = join(repositoryRoot, database.baselinePath);
	if (!existsSync(baselinePath)) return errors.push(`database baseline '${database.baselinePath}' does not exist`);
	if (sha256(baselinePath) !== database.baselineSha256) errors.push("database baseline digest differs from the release manifest");
}
