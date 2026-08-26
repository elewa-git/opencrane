import crypto from "node:crypto";
import fs from "node:fs";
import { createPostgresRunCommand } from "./commands.mjs";
import { runLocalCommand, runLocalCommandSpecification } from "./command-runner.mjs";
import { ensureOwnedVolume, inspectOwnedContainer, stopOwnedContainer } from "./container-resources.mjs";

async function _assertPostgresPasswordMatches(configuration, postgresPassword)
{
	const result = await runLocalCommand("docker", [
		"container",
		"inspect",
		configuration.postgresContainerName,
		"--format",
		"{{range .Config.Env}}{{println .}}{{end}}"
	], { signal: configuration.abortSignal });
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

async function _queryPostgres(configuration, sql)
{
	const result = await runLocalCommand("docker", _postgresArguments(configuration, "--tuples-only", "--no-align", "--command", sql), { signal: configuration.abortSignal });
	return result.stdout.trim();
}

async function _applySqlFile(configuration, filePath, variables = {})
{
	const variableArguments = Object.entries(variables).flatMap(function _toArguments([name, value])
	{
		return ["--set", `${name}=${value}`];
	});
	const sql = fs.readFileSync(filePath, "utf8");
	await runLocalCommand("docker", _postgresArguments(configuration, ...variableArguments), { input: sql, signal: configuration.abortSignal });
}

async function _waitForPostgres(configuration)
{
	for (let attempt = 0; attempt < 120; attempt += 1)
	{
		const result = await runLocalCommand("docker", [
			"exec",
			configuration.postgresContainerName,
			"pg_isready",
			"--username",
			"opencrane",
			"--dbname",
			"opencrane"
		], { acceptFailure: true, signal: configuration.abortSignal });

		if (result.status === 0)
		{
			return;
		}

		await new Promise(function _wait(resolve) { setTimeout(resolve, 250); });
	}

	throw new Error("The local PostgreSQL container did not become ready within 30 seconds");
}

/**
 * Waits for the owned PostgreSQL container and stops it when readiness fails.
 * Stopping on failure prevents an unsuccessful setup from leaving the owned container running.
 */
export async function waitForOwnedPostgres(configuration, waitForPostgres = _waitForPostgres, stopContainer = stopOwnedContainer)
{
	try
	{
		await waitForPostgres(configuration);
	}
	catch (error)
	{
		await stopContainer(configuration.postgresContainerName);
		throw error;
	}
}

/**
 * Starts or reuses the labelled PostgreSQL container after its persistent password is verified.
 * A failed or aborted start stops the attempted container before the coordinator releases its lock.
 *
 * @returns {Promise<true>} Tells the coordinator that it owns a running PostgreSQL container to stop.
 */
export async function startLocalPostgres(configuration, secrets)
{
	let startAttempted = false;

	try
	{
		await ensureOwnedVolume(configuration.postgresVolumeName, configuration.abortSignal);
		const state = await inspectOwnedContainer(configuration.postgresContainerName, configuration.abortSignal);

		if (!state.exists)
		{
			startAttempted = true;
			await runLocalCommandSpecification(createPostgresRunCommand(configuration, secrets), { signal: configuration.abortSignal });
		}
		else
		{
			await _assertPostgresPasswordMatches(configuration, secrets.postgresPassword);

			if (!state.running)
			{
				startAttempted = true;
				await runLocalCommand("docker", ["start", configuration.postgresContainerName], { signal: configuration.abortSignal });
			}
		}

		await waitForOwnedPostgres(configuration);
		configuration.abortSignal?.throwIfAborted();

		return true;
	}
	catch (error)
	{
		if (startAttempted)
		{
			await stopOwnedContainer(configuration.postgresContainerName);
		}

		throw error;
	}
}

/**
 * Creates Alternative A's LiteLLM database when the shared local PostgreSQL container lacks it.
 * Reusing the existing database preserves LiteLLM state between Tier 2 sessions.
 */
export async function ensureLocalLiteLLMDatabase(configuration, queryPostgres = _queryPostgres, runCommand = runLocalCommand)
{
	const exists = await queryPostgres(configuration, "SELECT 1 FROM pg_database WHERE datname = 'litellm';") === "1";

	if (exists)
	{
		return;
	}

	await runCommand("docker", _postgresArguments(configuration, "--command", "CREATE DATABASE litellm;"), { signal: configuration.abortSignal });
}

/**
 * Applies the target baseline to an empty local database and records its digest.
 * A changed or untracked schema requires `--reset`, which keeps this disposable workflow from
 * guessing an upgrade path that the release migration checks own.
 */
export async function applyTargetBaseline(configuration, operationOverrides = {})
{
	const operations = {
		applySqlFile: _applySqlFile,
		queryPostgres: _queryPostgres,
		readFile: fs.readFileSync,
		...operationOverrides
	};
	const baseline = operations.readFile(configuration.baselinePath);
	const baselineSha256 = crypto.createHash("sha256").update(baseline).digest("hex");
	const hasLocalState = await operations.queryPostgres(configuration, "SELECT to_regclass('public.opencrane_local_development_state') IS NOT NULL;") === "t";

	if (hasLocalState)
	{
		const appliedDigest = await operations.queryPostgres(configuration, "SELECT target_baseline_sha256 FROM opencrane_local_development_state WHERE id = 'baseline';");

		if (appliedDigest !== baselineSha256)
		{
			throw new Error("The persistent local database uses a different target baseline; rerun with --reset");
		}

		return;
	}

	const hasApplicationSchema = await operations.queryPostgres(configuration, "SELECT to_regclass('public.org_memberships') IS NOT NULL;") === "t";

	if (hasApplicationSchema)
	{
		throw new Error("The local database has an untracked application schema; rerun with --reset");
	}

	await operations.applySqlFile(configuration, configuration.baselinePath);
	await operations.applySqlFile(configuration, configuration.seedPath, { baseline_sha256: baselineSha256 });
}
