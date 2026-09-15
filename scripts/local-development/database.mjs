import fs from "node:fs";

import { runLocalCommand } from "./command-runner.mjs";

/** Builds an authenticated psql invocation inside the PostgreSQL container labeled for this checkout and target baseline. */
function _postgresArguments(configuration, ...argumentsList)
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
		...argumentsList
	];
}

function _sleep(milliseconds)
{
	return new Promise(function _wait(resolve) { setTimeout(resolve, milliseconds); });
}

async function _startupLogs(runCommand, configuration)
{
	const result = await runCommand("docker", [
		"logs",
		"--tail",
		"30",
		configuration.postgresContainerName
	], { acceptFailure: true, signal: configuration.abortSignal });

	if (result.status !== 0)
		return "Docker startup logs were unavailable.";

	const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");

	return output ? output.slice(-4_000) : "PostgreSQL wrote no startup logs.";
}

async function _containerState(runCommand, configuration)
{
	const result = await runCommand("docker", [
		"container",
		"inspect",
		configuration.postgresContainerName,
		"--format",
		"{{json .State}}"
	], { acceptFailure: true, signal: configuration.abortSignal });

	if (result.status !== 0)
		throw new Error("Tier 2 PostgreSQL container disappeared during startup");

	let state;

	try
	{
		state = JSON.parse(result.stdout.trim());
	}
	catch
	{
		throw new Error("Tier 2 PostgreSQL container returned invalid Docker state");
	}

	if (typeof state?.Running !== "boolean")
		throw new Error("Tier 2 PostgreSQL container returned incomplete Docker state");

	return state;
}

/** Waits for PostgreSQL, reporting an early container exit and its last startup logs before cleanup. */
export async function waitForPostgres(configuration, operations = {})
{
	const runCommand = operations.runCommand ?? runLocalCommand;
	const now = operations.now ?? Date.now;
	const sleep = operations.sleep ?? _sleep;
	const timeoutMilliseconds = configuration.emulateAmd64 ? 120_000 : 30_000;
	const deadline = now() + timeoutMilliseconds;

	while (now() < deadline)
	{
		const result = await runCommand("docker", [
			"exec",
			configuration.postgresContainerName,
			"pg_isready",
			"--username",
			"opencrane",
			"--dbname",
			"opencrane"
		], { acceptFailure: true, signal: configuration.abortSignal });

		if (result.status === 0)
			return;

		const state = await _containerState(runCommand, configuration);

		if (!state.Running)
		{
			const logs = await _startupLogs(runCommand, configuration);
			const reason = state.OOMKilled ? " (out of memory)" : "";

			throw new Error(`Tier 2 PostgreSQL exited with code ${state.ExitCode}${reason} before it became ready. Last startup logs:\n${logs}`);
		}

		await sleep(250);
	}

	const logs = await _startupLogs(runCommand, configuration);
	const seconds = timeoutMilliseconds / 1_000;

	throw new Error(`Tier 2 PostgreSQL did not become ready within ${seconds} seconds. Last startup logs:\n${logs}`);
}

/** Applies only the reviewed target baseline to an empty database, then replays the local seed. */
export async function applyTargetBaseline(configuration, operations = {})
{
	const runCommand = operations.runCommand ?? runLocalCommand;
	async function _query(sql)
	{
		const result = await runCommand("docker", _postgresArguments(configuration, "--tuples-only", "--no-align", "--command", sql), { signal: configuration.abortSignal });

		return result.stdout.trim();
	}

	const hasState = await _query("SELECT to_regclass('public.opencrane_local_development_state') IS NOT NULL;") === "t";

	if (hasState)
	{
		const digest = await _query("SELECT target_baseline_sha256 FROM opencrane_local_development_state WHERE id = 'baseline';");
		if (digest !== configuration.baselineDigest)
		{
			throw new Error("The paired local stores use a different target baseline; rerun with --reset");
		}
	}
	else
	{
		const hasSchema = await _query("SELECT to_regclass('public.org_memberships') IS NOT NULL;") === "t";
		if (hasSchema)
		{
			throw new Error("The local database has an untracked schema; rerun with --reset");
		}

		await runCommand("docker", _postgresArguments(configuration), { input: fs.readFileSync(configuration.baselinePath), signal: configuration.abortSignal });
		const stateSql = `CREATE TABLE opencrane_local_development_state (id text PRIMARY KEY, target_baseline_sha256 text NOT NULL); INSERT INTO opencrane_local_development_state VALUES ('baseline', '${configuration.baselineDigest}');`;
		await runCommand("docker", _postgresArguments(configuration, "--command", stateSql), { signal: configuration.abortSignal });
	}

	await runCommand("docker", _postgresArguments(configuration), { input: fs.readFileSync(configuration.seedPath), signal: configuration.abortSignal });
}

/** Invokes the same KurrentDB identity, ACL, and activation-subscription bootstrap as Helm. */
export async function bootstrapKurrent(configuration, secrets, operations = {})
{
	const runCommand = operations.runCommand ?? runLocalCommand;

	await runCommand("sh", [configuration.kurrentBootstrapPath], {
		environment: {
			KURRENTDB_BOOTSTRAP_ENDPOINT: `https://127.0.0.1:${configuration.kurrentPort}`,
			KURRENTDB_BOOTSTRAP_CA_FILE: secrets.caCertificatePath,
			KURRENTDB_BOOTSTRAP_ADMIN_PASSWORD_FILE: secrets.kurrentAdminPasswordPath,
			KURRENTDB_HISTORY_USERNAME_FILE: secrets.kurrentHistoryUsernamePath,
			KURRENTDB_HISTORY_PASSWORD_FILE: secrets.kurrentHistoryPasswordPath,
			KURRENTDB_BOOTSTRAP_SILO_ID: "local-development",
			KURRENTDB_BOOTSTRAP_MAX_SUBSCRIBERS: "1",
			KURRENTDB_BOOTSTRAP_TIMEOUT_SECONDS: "60"
		},
		signal: configuration.abortSignal
	});
}
