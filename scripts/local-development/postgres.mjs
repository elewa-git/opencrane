import crypto from "node:crypto";
import fs from "node:fs";
import { createPostgresRunCommand } from "./commands.mjs";
import { runLocalCommand, runLocalCommandSpecification } from "./command-runner.mjs";
import { ensureOwnedVolume, inspectOwnedContainer, stopOwnedContainer } from "./container-resources.mjs";

function _assertPostgresPasswordMatches(configuration, postgresPassword)
{
	const result = runLocalCommand("docker", [
		"container",
		"inspect",
		configuration.postgresContainerName,
		"--format",
		"{{range .Config.Env}}{{println .}}{{end}}"
	]);
	const configuredPassword = result.stdout
		.split("\n")
		.find(function _isPassword(entry) { return entry.startsWith("POSTGRES_PASSWORD="); })
		?.slice("POSTGRES_PASSWORD=".length);

	if (configuredPassword !== postgresPassword)
	{
		throw new Error("The local PostgreSQL credential does not match its persistent container; rerun with --reset");
	}
}

function _postgresArguments(configuration, ...additionalArguments)
{
	return [
		"exec",
		"--interactive",
		configuration.postgresContainerName,
		"psql",
		"--username",
		"opencrane",
		"--dbname",
		"opencrane",
		"--set",
		"ON_ERROR_STOP=1",
		...additionalArguments
	];
}

function _queryPostgres(configuration, sql)
{
	const result = runLocalCommand("docker", _postgresArguments(configuration, "--tuples-only", "--no-align", "--command", sql));
	return result.stdout.trim();
}

function _applySqlFile(configuration, filePath, variables = {})
{
	const variableArguments = Object.entries(variables).flatMap(function _toArguments([name, value])
	{
		return ["--set", `${name}=${value}`];
	});
	const sql = fs.readFileSync(filePath, "utf8");
	runLocalCommand("docker", _postgresArguments(configuration, ...variableArguments), { input: sql });
}

async function _waitForPostgres(configuration)
{
	for (let attempt = 0; attempt < 120; attempt += 1)
	{
		const result = runLocalCommand("docker", [
			"exec",
			configuration.postgresContainerName,
			"pg_isready",
			"--username",
			"opencrane",
			"--dbname",
			"opencrane"
		], { acceptFailure: true });

		if (result.status === 0)
		{
			return;
		}

		await new Promise(function _wait(resolve) { setTimeout(resolve, 250); });
	}

	throw new Error("The local PostgreSQL container did not become ready within 30 seconds");
}

/** Waits for the owned PostgreSQL container and stops it when readiness fails. */
export async function waitForOwnedPostgres(configuration, waitForPostgres = _waitForPostgres, stopContainer = stopOwnedContainer)
{
	try
	{
		await waitForPostgres(configuration);
	}
	catch (error)
	{
		stopContainer(configuration.postgresContainerName);
		throw error;
	}
}

/** Starts or reuses the labelled PostgreSQL container after its persistent password is verified. */
export async function startLocalPostgres(configuration, secrets)
{
	ensureOwnedVolume(configuration.postgresVolumeName);
	const state = inspectOwnedContainer(configuration.postgresContainerName);

	if (!state.exists)
	{
		runLocalCommandSpecification(createPostgresRunCommand(configuration, secrets));
	}
	else
	{
		_assertPostgresPasswordMatches(configuration, secrets.postgresPassword);

		if (!state.running)
		{
			runLocalCommand("docker", ["start", configuration.postgresContainerName]);
		}
	}

	await waitForOwnedPostgres(configuration);

	return true;
}

/** Creates Alternative A's LiteLLM database when the shared local PostgreSQL container lacks it. */
export function ensureLocalLiteLLMDatabase(configuration, queryPostgres = _queryPostgres, runCommand = runLocalCommand)
{
	const exists = queryPostgres(configuration, "SELECT 1 FROM pg_database WHERE datname = 'litellm';") === "1";

	if (exists)
	{
		return;
	}

	runCommand("docker", _postgresArguments(configuration, "--command", "CREATE DATABASE litellm;"));
}

/**
 * Applies the target baseline to an empty local database and records its digest.
 * A changed or untracked schema requires `--reset` so Tier 2 never guesses a migration path.
 */
export function applyTargetBaseline(configuration)
{
	const baseline = fs.readFileSync(configuration.baselinePath);
	const baselineSha256 = crypto.createHash("sha256").update(baseline).digest("hex");
	const hasLocalState = _queryPostgres(configuration, "SELECT to_regclass('public.opencrane_local_development_state') IS NOT NULL;") === "t";

	if (hasLocalState)
	{
		const appliedDigest = _queryPostgres(configuration, "SELECT target_baseline_sha256 FROM opencrane_local_development_state WHERE id = 'baseline';");

		if (appliedDigest !== baselineSha256)
		{
			throw new Error("The persistent local database uses a different target baseline; rerun with --reset");
		}

		return;
	}

	const hasApplicationSchema = _queryPostgres(configuration, "SELECT to_regclass('public.org_memberships') IS NOT NULL;") === "t";

	if (hasApplicationSchema)
	{
		throw new Error("The local database has an untracked application schema; rerun with --reset");
	}

	_applySqlFile(configuration, configuration.baselinePath);
	_applySqlFile(configuration, configuration.seedPath, { baseline_sha256: baselineSha256 });
}
