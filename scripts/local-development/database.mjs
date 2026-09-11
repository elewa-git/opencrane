import fs from "node:fs";

import { runLocalCommand } from "./command-runner.mjs";

/** Builds an authenticated psql invocation inside the exact-owned PostgreSQL container. */
function _postgresArguments(configuration, ...argumentsList)
{
	return ["exec", "--interactive", configuration.postgresContainerName, "psql", "--username", "opencrane", "--dbname", "opencrane", "--set", "ON_ERROR_STOP=1", ...argumentsList];
}

/** Waits for the clean local PostgreSQL operand to accept connections. */
export async function waitForPostgres(configuration, operations = {})
{
	const runCommand = operations.runCommand ?? runLocalCommand;
	for (let attempt = 0; attempt < 120; attempt += 1)
	{
		const result = await runCommand("docker", ["exec", configuration.postgresContainerName, "pg_isready", "--username", "opencrane", "--dbname", "opencrane"], { acceptFailure: true, signal: configuration.abortSignal });
		if (result.status === 0)
		{
			return;
		}
		await new Promise(function _wait(resolve) { setTimeout(resolve, 250); });
	}
	throw new Error("Tier 2 PostgreSQL did not become ready within 30 seconds");
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
