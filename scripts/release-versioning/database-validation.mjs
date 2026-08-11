import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { createReleaseManifestValidator } from "./manifest-validation.mjs";
import { compareSemver, isAdjacentMinor, readJson, sha256 } from "./version-utils.mjs";

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

/** Validate database baseline and migration evidence for one release manifest pair. */
export function validateDatabase(repositoryRoot, manifest, previousManifest, changedFiles, errors)
{
	const database = manifest.database;
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
	if (migrationManifest.fromSchemaVersion !== from || migrationManifest.toSchemaVersion !== database.schemaVersion)
		errors.push(`database migration manifest does not bind schema ${from} to ${database.schemaVersion}`);
	if (migrationManifest.sqlSha256 !== sha256(sqlPath)) errors.push("database migration SQL digest differs from its manifest");
	if (migrationManifest.owner !== "apps/opencrane") errors.push("database migration owner must be 'apps/opencrane'");
	if (migrationManifest.rollback !== "backup-restore-or-forward-repair")
		errors.push("database migration rollback must be 'backup-restore-or-forward-repair'");
	if (!["automatic", "automatic-when-legacy-persona-empty-otherwise-manual-data-mapping-required", "automatic-when-legacy-persona-and-conversations-empty-otherwise-manual-data-mapping-required", "automatic-when-legacy-persona-conversations-approval-requests-and-integration-assignments-empty-otherwise-manual-data-mapping-required"].includes(migrationManifest.executionMode))
		errors.push("database migration executionMode must declare its automatic upgrade boundary");
	if (migrationManifest.sourceTargetBaselineSha256 !== previousDatabase.baselineSha256)
		errors.push("database migration source baseline digest differs from the previous release manifest");
	if (migrationManifest.targetBaselineSha256 !== database.baselineSha256)
		errors.push("database migration target baseline digest differs from the current release manifest");
	if (!/^[a-f0-9]{64}$/u.test(migrationManifest.sourceProtectedBaselineSha256 ?? ""))
		errors.push("database migration must bind the exact protected source baseline digest");
}

/** Resolve the one validated database transition consumed by the deploy owner. */
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
			errors.push(`automatic database migration requires exact previous release '${target.previousRepositoryVersion}'`);
		if (!isAdjacentMinor(fromReleaseVersion, releaseVersion))
			errors.push(`automatic database migration permits only an adjacent minor transition: '${fromReleaseVersion}' -> '${releaseVersion}'`);
		kind = "migration";
	}
	validateDatabase(repositoryRoot, target, source, source ? [target.database.baselinePath] : [], errors);
	if (errors.length > 0) throw new Error(errors.join("; "));
	let migration = null;
	if (kind === "migration")
	{
		const id = `${source.database.schemaVersion}-to-${target.database.schemaVersion}`;
		const migrationRoot = join(repositoryRoot, "apps/opencrane/prisma/migrations", id);
		const migrationManifest = readJson(join(migrationRoot, "manifest.json"));
		migration = {
			id,
			fromSchemaVersion: source.database.schemaVersion,
			toSchemaVersion: target.database.schemaVersion,
			sqlFile: join(migrationRoot, "migration.sql"),
			sqlSha256: migrationManifest.sqlSha256,
			sourceProtectedBaselineSha256: migrationManifest.sourceProtectedBaselineSha256,
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
