import { runLocalCommand } from "./command-runner.mjs";

const _TERMINAL_CONTAINER_STATUSES = new Set(["dead", "exited"]);

function _redactStartupOutput(output, secrets, provider)
{
	const sensitiveValues = [
		provider?.providerKey,
		secrets.liteLLMMasterKey,
		secrets.liteLLMDatabasePassword
	].filter(Boolean).flatMap(function _EncodedForms(value)
	{
		return [value, encodeURIComponent(value)];
	}).sort(function _LongestFirst(left, right) { return right.length - left.length; });
	let redacted = output;

	for (const sensitiveValue of new Set(sensitiveValues))
		redacted = redacted.replaceAll(sensitiveValue, "[redacted]");

	redacted = redacted
		.replace(/(authorization\s*:\s*bearer\s+)[^\s]+/giu, "$1[redacted]")
		.replace(/((?:api[_-]?key|master[_-]?key|password)\s*[=:]\s*)[^\s,;]+/giu, "$1[redacted]");

	return redacted.slice(-4_000);
}

async function _startupLogs(runCommand, configuration, secrets, provider)
{
	const result = await runCommand("docker", [
		"logs",
		"--tail",
		"50",
		configuration.liteLLMContainerName
	], { acceptFailure: true, signal: configuration.abortSignal });

	if (result.status !== 0)
		return "Docker startup logs were unavailable.";

	const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");

	return output
		? _redactStartupOutput(output, secrets, provider)
		: "LiteLLM wrote no startup logs.";
}

async function _containerState(runCommand, configuration)
{
	const result = await runCommand("docker", [
		"container",
		"inspect",
		configuration.liteLLMContainerName,
		"--format",
		"{{json .State}}"
	], { acceptFailure: true, signal: configuration.abortSignal });

	if (result.status !== 0)
		throw new Error("Tier 2 LiteLLM container disappeared during startup");

	let state;

	try
	{
		state = JSON.parse(result.stdout.trim());
	}
	catch
	{
		throw new Error("Tier 2 LiteLLM container returned invalid Docker state");
	}

	if (
		typeof state?.Running !== "boolean"
		|| typeof state?.Status !== "string"
		|| typeof state?.ExitCode !== "number"
	)
	{
		throw new Error("Tier 2 LiteLLM container returned incomplete Docker state");
	}

	return state;
}

async function _throwStartupFailure(runCommand, configuration, secrets, provider, state, prefix)
{
	const logs = await _startupLogs(runCommand, configuration, secrets, provider);
	const reason = state.OOMKilled ? " (out of memory)" : "";

	throw new Error(`${prefix} (status=${state.Status} exit=${state.ExitCode}${reason}). Last redacted startup logs:\n${logs}`);
}

/**
 * Waits until the local LiteLLM proxy serves authenticated model and key-storage readiness requests.
 *
 * Startup failures include the Docker state and a short tail of startup logs. The caller must pass
 * the same provider used to start LiteLLM so its key joins the generated master key and database
 * password in the values removed from those diagnostics.
 *
 * @param configuration - Names the session container, readiness port, deadline and abort signal.
 * @param secrets - Supplies the readiness header and generated secrets that diagnostics must remove.
 * @param provider - Supplies the provider key that diagnostics must remove.
 * @param operations - Overrides command execution and delay behavior for tests.
 * @returns A promise that resolves after both readiness requests succeed.
 * @throws When Docker state cannot be read, the container stops before readiness, or the deadline expires.
 */
export async function waitForLocalLiteLLM(configuration, secrets, provider, operations = {})
{
	const runCommand = operations.runCommand ?? runLocalCommand;
	const delay = operations.delay ?? function _Delay() { return new Promise(function _Wait(resolve) { setTimeout(resolve, 250); }); };
	const paths = ["/v1/models", "/key/list"];
	const attempts = configuration.codespaceName ? 480 : 120;
	for (let attempt = 0; attempt < attempts; attempt += 1)
	{
		configuration.abortSignal?.throwIfAborted();
		let ready = true;
		for (const path of paths)
		{
			const result = await runCommand("curl", [
				"--silent", "--show-error", "--fail", "--output", "/dev/null",
				"--header", `@${secrets.liteLLMMasterAuthorizationHeaderPath}`,
				`http://127.0.0.1:${configuration.liteLLMPort}${path}`
			], { acceptFailure: true, signal: configuration.abortSignal });
			if (result.status !== 0)
			{
				ready = false;
				break;
			}
		}

		if (ready)
			return;

		const state = await _containerState(runCommand, configuration);

		if (!state.Running && _TERMINAL_CONTAINER_STATUSES.has(state.Status))
		{
			await _throwStartupFailure(
				runCommand,
				configuration,
				secrets,
				provider,
				state,
				"Tier 2 LiteLLM exited before model routing and key storage became ready"
			);
		}

		await delay();
	}

	const state = await _containerState(runCommand, configuration);
	const seconds = attempts / 4;
	await _throwStartupFailure(
		runCommand,
		configuration,
		secrets,
		provider,
		state,
		`Tier 2 LiteLLM model routing and key storage did not become ready within ${seconds} seconds`
	);
}
