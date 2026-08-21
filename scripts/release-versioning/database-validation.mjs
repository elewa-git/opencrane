import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { createReleaseManifestValidator } from "./manifest-validation.mjs";
import { compareSemver, isAdjacentMinor, isAdjacentPatch, readJson, sha256 } from "./version-utils.mjs";

/** Accepts only SHA-256 identities that can become deployment convergence evidence. */
const protectedBaselineDigestPattern = /^[a-f0-9]{64}$/u;

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
 * Checks a release pair's database baseline and migration evidence before the release can be used.
 * It admits a carry-forward only when an approved patch preserves its predecessor's database
 * identity; every violation is appended to `errors` so validation reports the whole release failure.
 * Called by: `validateWorkspace` and {@link resolveDatabaseTransition}.
 */
export function validateDatabase(repositoryRoot, manifest, previousManifest, changedFiles, errors)
{
	const database = manifest.database;
	_ValidateCarriedForwardTransition(repositoryRoot, manifest, previousManifest, errors);
	const baselinePath = join(repositoryRoot, database.baselinePath);
	if (!existsSync(baselinePath)) return errors.push(`database baseline '${database.baselinePath}' does not exist`);
	if (sha256(baselinePath) !== database.baselineSha256) errors.push("database baseline digest differs from the release manifest");
	if (compareSemver(database.schemaVersion, manifest.repositoryVersion) > 0) errors.push("database schema version exceeds root version");
	const baselineTouched = changedFiles.includes(database.baselinePath);
	if (manifest.adoptionBaseline)
	{
		if (baselineTouched) errors.push("database baseline changed after adoption; bump the root minor version and add an adjacent migration");
		return;
	}
	const previousDatabase = previousManifest?.database;
	if (!previousDatabase) return;
	const from = previousDatabase.schemaVersion;
	if (!from) return errors.push(`previous release manifest '${manifest.previousRepositoryVersion}' has no database schema version`);
	if (compareSemver(database.schemaVersion, from) < 0)
		errors.push(`database schema version regresses from '${from}' to '${database.schemaVersion}'`);
	if (baselineTouched && database.schemaVersion === from)
	{
		errors.push(`database baseline changed without advancing schema version '${database.schemaVersion}'`);
		return;
	}
	if (database.schemaVersion === from)
	{
		if (database.baselineSha256 !== previousDatabase.baselineSha256)
			errors.push(`database baseline digest changed without advancing schema version '${database.schemaVersion}'`);
		return;
	}
	if (database.schemaVersion !== manifest.repositoryVersion)
		errors.push("changed database schema must be stamped to the root version");
	const migrationRoot = join(repositoryRoot, "apps/opencrane/prisma/migrations", `${from}-to-${database.schemaVersion}`);
	const sqlPath = join(migrationRoot, "migration.sql");
	const migrationManifestPath = join(migrationRoot, "manifest.json");
	if (!existsSync(sqlPath) || !existsSync(migrationManifestPath))
	{
		errors.push(`database change requires reviewed migration '${relative(repositoryRoot, migrationRoot)}'`);
		return;
	}
	const migrationManifest = _ReadMigrationManifest(
		migrationManifestPath,
		`database migration manifest '${relative(repositoryRoot, migrationManifestPath)}'`,
		errors,
	);
	if (!migrationManifest) return;
	if (migrationManifest.privilegedExtension !== undefined && migrationManifest.privilegedExtension !== "pg_cron")
		errors.push("database migration privilegedExtension must be the reviewed 'pg_cron' exception");
	if (migrationManifest.fromSchemaVersion !== from || migrationManifest.toSchemaVersion !== database.schemaVersion)
		errors.push(`database migration manifest does not bind schema ${from} to ${database.schemaVersion}`);
	if (migrationManifest.sqlSha256 !== sha256(sqlPath)) errors.push("database migration SQL digest differs from its manifest");
	if (migrationManifest.owner !== "apps/opencrane") errors.push("database migration owner must be 'apps/opencrane'");
	if (migrationManifest.rollback !== "backup-restore-or-forward-repair")
		errors.push("database migration rollback must be 'backup-restore-or-forward-repair'");
	if (!["automatic", "automatic-when-legacy-persona-empty-otherwise-manual-data-mapping-required", "automatic-when-legacy-persona-and-conversations-empty-otherwise-manual-data-mapping-required", "automatic-when-legacy-persona-conversations-approval-requests-and-integration-assignments-empty-otherwise-manual-data-mapping-required", "automatic-when-legacy-persona-conversations-channel-invocation-contexts-approval-requests-and-integration-assignments-empty-otherwise-manual-data-mapping-required"].includes(migrationManifest.executionMode))
		errors.push("database migration executionMode must declare its automatic upgrade boundary");
	if (migrationManifest.sourceTargetBaselineSha256 !== previousDatabase.baselineSha256)
		errors.push("database migration source baseline digest differs from the previous release manifest");
	if (migrationManifest.targetBaselineSha256 !== database.baselineSha256)
		errors.push("database migration target baseline digest differs from the current release manifest");
	const sourceProtectedBaselineSha256s = _SourceProtectedBaselineDigests(migrationManifest);
	if (sourceProtectedBaselineSha256s.length === 0
		|| sourceProtectedBaselineSha256s.some((digest) => !protectedBaselineDigestPattern.test(digest))
		|| new Set(sourceProtectedBaselineSha256s).size !== sourceProtectedBaselineSha256s.length)
	{
		errors.push("database migration must bind a non-empty unique set of protected source baseline digests");
	}
	else if (!protectedBaselineDigestPattern.test(_FreshSourceProtectedBaselineDigest(migrationManifest) ?? "")
		|| !sourceProtectedBaselineSha256s.includes(_FreshSourceProtectedBaselineDigest(migrationManifest)))
	{
		errors.push("database migration must identify its fresh protected source baseline inside the admitted set");
	}
	// Fresh installs hash the bootstrap SQL together with the database owner. The raw baseline digest
	// therefore cannot prove the protected origin read from a live database.
	else if (_FreshSourceProtectedBaselineDigest(migrationManifest) === migrationManifest.sourceTargetBaselineSha256)
	{
		errors.push("database migration fresh protected source digest must identify the bootstrap envelope, not the raw source baseline");
	}
}

/**
 * Validates the requested release pair and describes the database state that deployment must reach.
 * An approved next-patch repair may reuse its predecessor's migration from that migration's original
 * source; every other non-adjacent source is rejected. The result binds migration SQL, every admitted
 * protected origin, and each origin's prior history.
 * Called by: `database-transition.mjs`, which supplies this evidence to the deployment script.
 * @throws {Error} When either manifest or its database transition is invalid.
 */
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
				// Reporting history, not authorizing a carry-forward override.
				carriedForwardThroughReleaseVersion: null,
				ownedByReleaseVersion: cursor.repositoryVersion,
			};
		}
		cursor = predecessor;
	}
	return null;
}

export function resolveDatabaseTransition(repositoryRoot, releaseVersion, fromReleaseVersion)
{
	const rootVersion = readJson(join(repositoryRoot, "package.json")).version;
	const targetPath = join(repositoryRoot, "releases", `${releaseVersion}.json`);
	if (!existsSync(targetPath)) throw new Error(`release manifest is missing: ${targetPath}`);
	const target = readJson(targetPath);
	const validateManifest = createReleaseManifestValidator(repositoryRoot);
	const errors = validateManifest(target);
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
		if (source && migrationOwner.database.schemaVersion !== source.database.schemaVersion) kind = "migration";
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
			carriedForwardThroughReleaseVersion: migrationOwner === target ? null : migrationOwner.repositoryVersion,
		};
	}
	return {
		kind,
		releaseVersion,
		fromReleaseVersion,
		targetSchemaVersion: target.database.schemaVersion,
		targetBaselineSha256: target.database.baselineSha256,
		migration,
	};
}
