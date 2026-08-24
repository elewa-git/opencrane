import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { createReleaseManifestValidator } from "./manifest-validation.mjs";
import { compareSemver, isAdjacentMinor, isAdjacentPatch, readJson, sha256 } from "./version-utils.mjs";

/** Matches SHA-256 digests recorded in historical migration manifests. */
const protectedBaselineDigestPattern = /^[a-f0-9]{64}$/u;
const operandImagePattern = /:[0-9]+(?:\.[0-9]+)*(?:[-_.][A-Za-z0-9_.-]+)?@sha256:[a-f0-9]{64}$/u;

/**
 * Checks that the current release binds a PostgreSQL operand whose tag exposes its version and
 * whose digest fixes its bytes.
 *
 * CNPG reads the PostgreSQL major version from the tag before it decides how to upgrade. When the
 * release declares the PostgreSQL chart's external major, the two versions must agree or CNPG would
 * make that decision from false metadata.
 *
 * Called by: `validateWorkspace` and {@link resolveDatabaseTransition}.
 * @param manifest - Current release manifest whose PostgreSQL operand will be deployed.
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

function _ReadMigrationManifest(path, description, errors)
{
	try
	{
		return readJson(path);
	}
	catch (error)
	{
		errors.push(`${description} is not valid JSON: ${error.message}`);
		return null;
	}
}

/**
 * Normalizes historical singular manifests while preserving protected-origin order.
 * The resolver pairs each origin with the same-index `sourceHistoryLineages` entry, so consumers must
 * reorder both arrays together; after release tagging, the manifest and this pairing are immutable.
 */
function _SourceProtectedBaselineDigests(migrationManifest)
{
	if (Array.isArray(migrationManifest.sourceProtectedBaselineSha256s))
		return migrationManifest.sourceProtectedBaselineSha256s;
	if (typeof migrationManifest.sourceProtectedBaselineSha256 === "string")
		return [migrationManifest.sourceProtectedBaselineSha256];
	return [];
}

/** Uses the sole admitted origin when a historical manifest predates an explicit fresh-origin field. */
function _FreshSourceProtectedBaselineDigest(migrationManifest)
{
	if (Array.isArray(migrationManifest.sourceProtectedBaselineSha256s))
		return migrationManifest.freshSourceProtectedBaselineSha256;
	return migrationManifest.sourceProtectedBaselineSha256;
}

function _DatabaseIdentity(database)
{
	return [database.schemaVersion, database.baselinePath, database.baselineSha256].join("|");
}

/**
 * Restricts a carry-forward to the approved next-patch repair of its predecessor's migration.
 * The repair must preserve that predecessor's database identity and original adjacent-minor source.
 */
function _ValidateCarriedForwardTransition(repositoryRoot, manifest, previousManifest, errors)
{
	const carriedFrom = manifest.database.carriedForwardFromRepositoryVersion;
	if (!carriedFrom) return;
	if (manifest.manualTransition?.approved !== true
		|| typeof manifest.manualTransition.reason !== "string"
		|| manifest.manualTransition.reason.trim() === "")
		errors.push("database carry-forward requires an explicitly approved manual patch transition");
	if (!previousManifest)
	{
		errors.push("database carry-forward requires the immediate predecessor release manifest");
		return;
	}
	if (!isAdjacentPatch(previousManifest.repositoryVersion, manifest.repositoryVersion))
		errors.push("database carry-forward is allowed only on the immediate next patch release");
	if (previousManifest.previousRepositoryVersion !== carriedFrom)
		errors.push("database carry-forward source must be the predecessor release's exact source");
	if (_DatabaseIdentity(manifest.database) !== _DatabaseIdentity(previousManifest.database))
		errors.push("database carry-forward must preserve the predecessor database identity exactly");
	const sourcePath = join(repositoryRoot, "releases", `${carriedFrom}.json`);
	if (!existsSync(sourcePath))
	{
		errors.push(`database carry-forward source release manifest is missing: ${sourcePath}`);
		return;
	}
	const source = readJson(sourcePath);
	if (!isAdjacentMinor(carriedFrom, previousManifest.repositoryVersion))
		errors.push("database carry-forward may retain only an adjacent-minor predecessor migration");
	if (source.database.schemaVersion === previousManifest.database.schemaVersion)
		errors.push("database carry-forward source must own a real predecessor schema transition");
}

/**
 * Rebuilds each admitted origin's earlier migration rows from the release ledger.
 * An origin stops accumulating history when an older transition no longer admits it, which lets the
 * deploy classifier reject a live history that did not follow every recorded transition.
 */
function _SourceHistoryLineages(repositoryRoot, sourceRelease, sourceProtectedBaselineSha256s)
{
	const lineages = sourceProtectedBaselineSha256s.map((sourceProtectedBaselineSha256) => ({
		sourceProtectedBaselineSha256,
		history: [],
	}));
	const activeOrigins = new Set(sourceProtectedBaselineSha256s);
	let cursor = sourceRelease;
	while (cursor?.previousRepositoryVersion)
	{
		const predecessor = readJson(join(repositoryRoot, "releases", `${cursor.previousRepositoryVersion}.json`));
		if (predecessor.database.schemaVersion !== cursor.database.schemaVersion)
		{
			const migrationId = `${predecessor.database.schemaVersion}-to-${cursor.database.schemaVersion}`;
			const migrationManifest = readJson(join(
				repositoryRoot,
				"apps/opencrane/prisma/migrations",
				migrationId,
				"manifest.json",
			));
			const transitionOrigins = new Set(_SourceProtectedBaselineDigests(migrationManifest));
			for (const lineage of lineages)
			{
				const origin = lineage.sourceProtectedBaselineSha256;
				if (!activeOrigins.has(origin)) continue;
				if (!transitionOrigins.has(origin))
				{
					activeOrigins.delete(origin);
					continue;
				}
				lineage.history.unshift({
					schemaVersion: cursor.database.schemaVersion,
					sourceSchemaVersion: predecessor.database.schemaVersion,
					sourceProtectedBaselineSha256: origin,
					targetBaselineSha256: cursor.database.baselineSha256,
					migrationId,
					sqlSha256: migrationManifest.sqlSha256,
				});
			}
		}
		cursor = predecessor;
	}
	return lineages;
}

/**
 * Checks that a release manifest names existing baseline bytes with the digest it records.
 * This keeps a manifest from referring to missing or changed fresh-install SQL. Each problem is
 * appended to `errors` so callers can report every invalid release input together.
 *
 * Called by: `validateWorkspace` and {@link resolveDatabaseTransition}.
 */
export function validateDatabase(repositoryRoot, manifest, previousManifest, changedFiles, errors)
{
	const database = manifest.database;
	const baselinePath = join(repositoryRoot, database.baselinePath);
	if (!existsSync(baselinePath)) return errors.push(`database baseline '${database.baselinePath}' does not exist`);
	if (sha256(baselinePath) !== database.baselineSha256) errors.push("database baseline digest differs from the release manifest");
}

/**
 * Finds the migration that last produced this release's database schema version.
 *
 * A same-schema patch train resolves to `current` with no migration of its own, but a live database
 * that reached this schema through a real migration still records that transition, and privilege
 * reconciliation compares the database against exactly that record. Walking the release chain
 * recovers the evidence the database already carries; it never proposes a new migration, so the
 * transition stays `current`.
 *
 * Called by: `scripts/release-versioning/schema-lineage.mjs`, which the deploy engine invokes when a
 * transition carries no migration.
 * @param repositoryRoot - Repository root holding `releases/` and the migration manifests.
 * @param releaseVersion - The release being deployed.
 * @returns The owning migration's evidence, or null when this schema was never migrated into.
 * @see resolveDatabaseTransition
 */
export function resolveSchemaLineage(repositoryRoot, releaseVersion)
{
	const targetPath = join(repositoryRoot, "releases", `${releaseVersion}.json`);
	if (!existsSync(targetPath)) throw new Error(`release manifest is missing: ${targetPath}`);
	const target = readJson(targetPath);
	const schemaVersion = target.database.schemaVersion;
	let cursor = target;
	while (cursor?.previousRepositoryVersion)
	{
		const predecessorPath = join(repositoryRoot, "releases", `${cursor.previousRepositoryVersion}.json`);
		if (!existsSync(predecessorPath))
			throw new Error(`release manifest is missing: ${predecessorPath}`);
		const predecessor = readJson(predecessorPath);
		if (cursor.database.schemaVersion === schemaVersion && predecessor.database.schemaVersion !== schemaVersion)
		{
			const id = `${predecessor.database.schemaVersion}-to-${schemaVersion}`;
			const migrationRoot = join(repositoryRoot, "apps/opencrane/prisma/migrations", id);
			const migrationManifest = readJson(join(migrationRoot, "manifest.json"));
			const sourceProtectedBaselineSha256s = _SourceProtectedBaselineDigests(migrationManifest);
			return {
				id,
				fromSchemaVersion: predecessor.database.schemaVersion,
				toSchemaVersion: schemaVersion,
				sqlFile: join(migrationRoot, "migration.sql"),
				sqlSha256: migrationManifest.sqlSha256,
				sourceTargetBaselineSha256: migrationManifest.sourceTargetBaselineSha256,
				sourceProtectedBaselineSha256s,
				freshSourceProtectedBaselineSha256: _FreshSourceProtectedBaselineDigest(migrationManifest),
				sourceHistoryLineages: _SourceHistoryLineages(repositoryRoot, predecessor, sourceProtectedBaselineSha256s),
				ownedByReleaseVersion: cursor.repositoryVersion,
			};
		}
		cursor = predecessor;
	}
	return null;
}

/**
 * Validates a release pair and describes the database state that deployment must reach.
 * Automatic callers may cross an adjacent minor version; a version-specific resolver may also name
 * a manifest-approved adjacent patch transition without allowing the generic CLI to admit it.
 *
 * Called by: `database-transition.mjs` and the reviewed `database-transition-0.9.3.mjs` exception.
 * @param repositoryRoot - Repository root that holds release and migration manifests.
 * @param releaseVersion - Release the deployment must reach.
 * @param fromReleaseVersion - Installed release, or `fresh` for an empty database.
 * @param options - A version-specific manual transition identifier, when the release manifest approves it.
 * @returns The transition kind and the manifest-bound migration evidence needed by deployment.
 * @throws {Error} When either manifest or the requested database transition is invalid.
 */
export function resolveDatabaseTransition(repositoryRoot, releaseVersion, fromReleaseVersion, options = {})
{
	const rootVersion = readJson(join(repositoryRoot, "package.json")).version;
	const targetPath = join(repositoryRoot, "releases", `${releaseVersion}.json`);
	if (!existsSync(targetPath)) throw new Error(`release manifest is missing: ${targetPath}`);
	const target = readJson(targetPath);
	const validateManifest = createReleaseManifestValidator(repositoryRoot);
	const errors = validateManifest(target);
	validateDatabaseOperand(target, errors);
	if (releaseVersion !== rootVersion || releaseVersion !== target.repositoryVersion)
		errors.push(`release version '${releaseVersion}' must equal root and manifest version '${rootVersion}'`);
	let kind = fromReleaseVersion === "fresh" ? "fresh" : "current";
	let source = null;
	let migrationOwner = target;
	if (fromReleaseVersion !== "fresh" && fromReleaseVersion !== releaseVersion)
	{
		const sourcePath = join(repositoryRoot, "releases", `${fromReleaseVersion}.json`);
		if (!existsSync(sourcePath)) errors.push(`source release manifest is missing: ${sourcePath}`);
		else
		{
			source = readJson(sourcePath);
			errors.push(...validateManifest(source, "source release manifest"));
			if (source.repositoryVersion !== fromReleaseVersion)
				errors.push(`source release manifest does not bind '${fromReleaseVersion}'`);
		}
		if (target.previousRepositoryVersion !== fromReleaseVersion)
		{
			const predecessorPath = join(repositoryRoot, "releases", `${target.previousRepositoryVersion}.json`);
			const predecessor = existsSync(predecessorPath) ? readJson(predecessorPath) : null;
			if (target.database.carriedForwardFromRepositoryVersion === fromReleaseVersion
				&& predecessor?.previousRepositoryVersion === fromReleaseVersion)
			{
				migrationOwner = predecessor;
			}
			else errors.push(`automatic database migration requires exact previous release '${target.previousRepositoryVersion}'`);
		}
		if (source)
		{
			// A manual exception must match both the requested pair and its release manifest, so a
			// version-specific resolver cannot authorize another patch transition by accident.
			const manualTransitionId = `${fromReleaseVersion}-to-${releaseVersion}`;
			const approvedManualPatch = options.manualTransitionId === manualTransitionId
				&& isAdjacentPatch(fromReleaseVersion, releaseVersion)
				&& target.manualTransition?.approved === true;
			if (migrationOwner.database.schemaVersion !== source.database.schemaVersion
				&& !isAdjacentMinor(fromReleaseVersion, migrationOwner.repositoryVersion)
				&& !approvedManualPatch)
				errors.push(`automatic database migration permits only an adjacent minor transition: '${fromReleaseVersion}' -> '${releaseVersion}'`);
			if (migrationOwner.database.schemaVersion !== source.database.schemaVersion) kind = "migration";
		}
	}
	// A release transition alone does not change the bootstrap SQL. Compare its digest to the
	// source manifest; only the workspace validator receives an actual changed-file list.
	if (migrationOwner === target)
	{
		let validationPrevious = source;
		if (!validationPrevious && target.database.carriedForwardFromRepositoryVersion)
		{
			const previousPath = join(repositoryRoot, "releases", `${target.previousRepositoryVersion}.json`);
			validationPrevious = existsSync(previousPath) ? readJson(previousPath) : null;
		}
		validateDatabase(repositoryRoot, target, validationPrevious, [], errors);
	}
	else
	{
		validateDatabase(repositoryRoot, target, migrationOwner, [], errors);
		validateDatabase(repositoryRoot, migrationOwner, source, [], errors);
	}
	if (errors.length > 0) throw new Error(errors.join("; "));
	let migration = null;
	if (kind === "migration")
	{
		const id = `${source.database.schemaVersion}-to-${target.database.schemaVersion}`;
		const migrationRoot = join(repositoryRoot, "apps/opencrane/prisma/migrations", id);
		const migrationManifest = readJson(join(migrationRoot, "manifest.json"));
		const sourceProtectedBaselineSha256s = _SourceProtectedBaselineDigests(migrationManifest);
		migration = {
			id,
			fromSchemaVersion: source.database.schemaVersion,
			toSchemaVersion: target.database.schemaVersion,
			sqlFile: join(migrationRoot, "migration.sql"),
			sqlSha256: migrationManifest.sqlSha256,
			sourceTargetBaselineSha256: migrationManifest.sourceTargetBaselineSha256,
			sourceProtectedBaselineSha256s,
			freshSourceProtectedBaselineSha256: _FreshSourceProtectedBaselineDigest(migrationManifest),
			sourceHistoryLineages: _SourceHistoryLineages(repositoryRoot, source, sourceProtectedBaselineSha256s),
			privilegedExtension: migrationManifest.privilegedExtension ?? null,
		};
	}
	return {
		kind,
		releaseVersion,
		fromReleaseVersion,
		operandImage: target.database.operandImage ?? null,
		targetSchemaVersion: target.database.schemaVersion,
		targetBaselineSha256: target.database.baselineSha256,
		migration,
	};
}
