import { runLocalCommand } from "./command-runner.mjs";

/** Lists Docker states that cannot become ready without another container start. */
const _TERMINAL_CONTAINER_STATUSES = new Set(["dead", "exited"]);
/** Limits recovery when LiteLLM starts before its embedded Prisma query engine can accept requests. */
const _CODESPACES_PRISMA_ENGINE_RESTART_LIMIT = 2;
/**
 * Matches LiteLLM's reported failure when its local Prisma query-engine process is unavailable.
 * @see https://github.com/BerriAI/litellm/issues/11766 for the matching upstream traceback.
 */
const _PRISMA_ENGINE_CONNECTION_FAILURE = "EngineConnectionError: Could not connect to the query engine";
/**
 * Matches the lower-level Prisma health-check traceback emitted without its connection wrapper.
 * @see https://github.com/BerriAI/litellm/issues/4552 for the same internal HTTP request path.
 */
const _PRISMA_ENGINE_HTTP_CONNECTION_FAILURE_MARKERS = [
	"in _setup_prisma_client",
	"/prisma/engine/http.py",
	"httpx.ConnectError: All connection attempts failed"
];
/** Leaves time inside the startup budget to collect Docker state and logs after readiness probing stops. */
const _STARTUP_DIAGNOSTIC_RESERVE_MILLISECONDS = 2_000;
/** Sets how often the launcher checks LiteLLM readiness. */
const _READINESS_POLL_MILLISECONDS = 250;
/** Lets a timed-out readiness command terminate before the startup deadline. */
const _READINESS_COMMAND_SHUTDOWN_GRACE_MILLISECONDS = 100;

/** Returns the time that remains before a monotonic deadline. */
function _remainingMilliseconds(deadline, now)
{
	return Math.max(0, deadline - now());
}

/** Combines session cancellation with the remaining startup time for one child command. */
function _commandSignal(configuration, deadline, now)
{
	const remainingMilliseconds = _remainingMilliseconds(deadline, now);
	const executionMilliseconds = remainingMilliseconds - _READINESS_COMMAND_SHUTDOWN_GRACE_MILLISECONDS;

	if (executionMilliseconds <= 0)
		throw new DOMException("Tier 2 LiteLLM readiness deadline elapsed", "TimeoutError");

	const timeoutSignal = AbortSignal.timeout(Math.ceil(executionMilliseconds));

	return configuration.abortSignal
		? AbortSignal.any([configuration.abortSignal, timeoutSignal])
		: timeoutSignal;
}

/** Distinguishes this readiness deadline from cancellation of the whole Tier 2 session. */
function _isReadinessDeadline(error, configuration)
{
	return !configuration.abortSignal?.aborted && error?.name === "TimeoutError";
}

/** Removes the provider, LiteLLM master and database credentials before returning a bounded diagnostic tail. */
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

	return redacted.slice(-12_000);
}

/** Reads logs emitted since the inspected container start and removes launch credentials. */
async function _startupLogs(runCommand, configuration, secrets, provider, state, deadline, now)
{
	const result = await runCommand("docker", [
		"logs",
		"--since",
		state.StartedAt,
		"--tail",
		"200",
		configuration.liteLLMContainerName
	], {
		acceptFailure: true,
		shutdownGraceMilliseconds: _READINESS_COMMAND_SHUTDOWN_GRACE_MILLISECONDS,
		signal: _commandSignal(configuration, deadline, now)
	});

	if (result.status !== 0)
		return "Docker startup logs were unavailable.";

	const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");

	return output
		? _redactStartupOutput(output, secrets, provider)
		: "LiteLLM wrote no startup logs.";
}

/** Reads the Docker state needed to decide whether startup can continue. */
async function _containerState(runCommand, configuration, deadline, now)
{
	const result = await runCommand("docker", [
		"container",
		"inspect",
		configuration.liteLLMContainerName,
		"--format",
		"{{json .State}}"
	], {
		acceptFailure: true,
		shutdownGraceMilliseconds: _READINESS_COMMAND_SHUTDOWN_GRACE_MILLISECONDS,
		signal: _commandSignal(configuration, deadline, now)
	});

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
		|| typeof state?.StartedAt !== "string"
	)
	{
		throw new Error("Tier 2 LiteLLM container returned incomplete Docker state");
	}

	return state;
}

/** Builds a startup error from the last Docker state and redacted log tail. */
function _startupFailure(state, prefix, logs)
{
	const reason = state.OOMKilled ? " (out of memory)" : "";

	return new Error(`${prefix} (status=${state.Status} exit=${state.ExitCode}${reason}). Last redacted startup logs:\n${logs}`);
}

/** Recognises either observed traceback shape for the embedded Prisma query-engine failure. */
function _hasPrismaEngineConnectionFailure(logs)
{
	if (logs.includes(_PRISMA_ENGINE_CONNECTION_FAILURE))
		return true;

	const hasRawHealthCheckTrace = _PRISMA_ENGINE_HTTP_CONNECTION_FAILURE_MARKERS.every(
		(marker) => logs.includes(marker)
	);

	return hasRawHealthCheckTrace;
}

/** Allows recovery only for the known Codespaces Prisma query-engine connection failure. */
function _isRetryablePrismaEngineConnectionFailure(configuration, state, logs)
{
	return Boolean(configuration.codespaceName)
		&& state.ExitCode === 3
		&& _hasPrismaEngineConnectionFailure(logs);
}

/** Starts the same stopped LiteLLM container and reports whether Docker accepted the request. */
async function _restartLiteLLM(runCommand, configuration, deadline, now)
{
	const result = await runCommand("docker", [
		"start",
		configuration.liteLLMContainerName
	], {
		acceptFailure: true,
		shutdownGraceMilliseconds: _READINESS_COMMAND_SHUTDOWN_GRACE_MILLISECONDS,
		signal: _commandSignal(configuration, deadline, now)
	});

	return result.status === 0;
}

/**
 * Waits until the local LiteLLM proxy serves authenticated model and key-storage readiness requests.
 *
 * Codespaces receives a 120-second budget and workstations receive 30 seconds. Readiness probing
 * stops two seconds before the monotonic startup deadline so Docker state and current-start logs can
 * be collected. Only in Codespaces, exit code 3 with either recognised Prisma connection traceback
 * restarts the same container, at most twice; other terminal states fail without a restart.
 * Startup failures include the latest Docker state and, when Docker returns it within that budget,
 * logs from the current container start. The caller must pass the same provider used to start LiteLLM so its key
 * joins the generated master key and database password in the values removed from those diagnostics.
 *
 * @param configuration - Names the session container and readiness port, identifies Codespaces, and supplies the session abort signal.
 * @param secrets - Supplies the readiness header and generated secrets that diagnostics must remove.
 * @param provider - Supplies the provider key that diagnostics must remove.
 * @param operations - Overrides command execution and delay behavior for tests.
 * @returns A promise that resolves after both readiness requests succeed.
 * @throws When Docker state cannot be read, a terminal container failure is not recoverable or exhausts its retries, or the startup budget expires.
 */
export async function waitForLocalLiteLLM(configuration, secrets, provider, operations = {})
{
	const runCommand = operations.runCommand ?? runLocalCommand;
	const delay = operations.delay ?? function _Delay(milliseconds) { return new Promise(function _Wait(resolve) { setTimeout(resolve, milliseconds); }); };
	const now = operations.now ?? function _Now() { return performance.now(); };
	const paths = ["/v1/models", "/key/list"];
	const timeoutMilliseconds = configuration.codespaceName ? 120_000 : 30_000;
	const deadline = now() + timeoutMilliseconds;
	const probeDeadline = deadline - _STARTUP_DIAGNOSTIC_RESERVE_MILLISECONDS;
	let prismaEngineRestarts = 0;
	let lastState;
	let readinessDeadlineReached = false;
	while (_remainingMilliseconds(probeDeadline, now) > 0)
	{
		configuration.abortSignal?.throwIfAborted();
		let ready = true;
		for (const path of paths)
		{
			const remainingMilliseconds = _remainingMilliseconds(probeDeadline, now);
			if (remainingMilliseconds <= 0)
			{
				readinessDeadlineReached = true;
				ready = false;
				break;
			}

			const executionMilliseconds = remainingMilliseconds - _READINESS_COMMAND_SHUTDOWN_GRACE_MILLISECONDS;
			if (executionMilliseconds <= 0)
			{
				readinessDeadlineReached = true;
				ready = false;
				break;
			}

			const curlTimeoutSeconds = Math.max(0.001, executionMilliseconds / 1_000).toFixed(3);
			let result;

			try
			{
				result = await runCommand("curl", [
					"--silent", "--show-error", "--fail", "--output", "/dev/null",
					"--connect-timeout", curlTimeoutSeconds,
					"--max-time", curlTimeoutSeconds,
					"--header", `@${secrets.liteLLMMasterAuthorizationHeaderPath}`,
					`http://127.0.0.1:${configuration.liteLLMPort}${path}`
				], {
					acceptFailure: true,
					shutdownGraceMilliseconds: _READINESS_COMMAND_SHUTDOWN_GRACE_MILLISECONDS,
					signal: _commandSignal(configuration, probeDeadline, now)
				});
			}
			catch (error)
			{
				if (!_isReadinessDeadline(error, configuration))
					throw error;

				readinessDeadlineReached = true;
				ready = false;
				break;
			}

			if (result.status !== 0)
			{
				ready = false;
				break;
			}
		}

		if (ready)
			return;

		if (readinessDeadlineReached)
			break;

		let state;

		try
		{
			state = await _containerState(runCommand, configuration, probeDeadline, now);
		}
		catch (error)
		{
			if (!_isReadinessDeadline(error, configuration))
				throw error;

			break;
		}

		lastState = state;

		if (!state.Running && _TERMINAL_CONTAINER_STATUSES.has(state.Status))
		{
			let logs;

			try
			{
				logs = await _startupLogs(runCommand, configuration, secrets, provider, state, deadline, now);
			}
			catch (error)
			{
				if (!_isReadinessDeadline(error, configuration))
					throw error;

				break;
			}

			const retryablePrismaFailure = _isRetryablePrismaEngineConnectionFailure(configuration, state, logs);

			if (
				retryablePrismaFailure
				&& prismaEngineRestarts < _CODESPACES_PRISMA_ENGINE_RESTART_LIMIT
				&& _remainingMilliseconds(probeDeadline, now) > 0
			)
			{
				let restarted;

				try
				{
					restarted = await _restartLiteLLM(runCommand, configuration, probeDeadline, now);
				}
				catch (error)
				{
					if (!_isReadinessDeadline(error, configuration))
						throw error;

					break;
				}

				if (!restarted)
				{
					throw _startupFailure(
						state,
						"Tier 2 could not restart LiteLLM after its Prisma query engine failed to start",
						logs
					);
				}

				prismaEngineRestarts += 1;
				const delayMilliseconds = Math.min(
					_READINESS_POLL_MILLISECONDS,
					_remainingMilliseconds(probeDeadline, now)
				);
				await delay(delayMilliseconds);
				continue;
			}

			let prefix = "Tier 2 LiteLLM exited before model routing and key storage became ready";
			if (retryablePrismaFailure)
				prefix += ` after ${prismaEngineRestarts} automatic restarts`;

			throw _startupFailure(state, prefix, logs);
		}

		const delayMilliseconds = Math.min(
			_READINESS_POLL_MILLISECONDS,
			_remainingMilliseconds(probeDeadline, now)
		);
		await delay(delayMilliseconds);
	}

	let state = lastState;
	let logs = "Docker startup logs were unavailable before the readiness deadline elapsed.";

	try
	{
		if (_remainingMilliseconds(deadline, now) > 0)
			state = await _containerState(runCommand, configuration, deadline, now);

		if (state && _remainingMilliseconds(deadline, now) > 0)
			logs = await _startupLogs(runCommand, configuration, secrets, provider, state, deadline, now);
	}
	catch (error)
	{
		if (!_isReadinessDeadline(error, configuration))
			throw error;
	}

	const failureState = state ?? {
		ExitCode: -1,
		OOMKilled: false,
		Running: false,
		StartedAt: "unknown",
		Status: "unknown"
	};
	const seconds = timeoutMilliseconds / 1_000;

	throw _startupFailure(
		failureState,
		`Tier 2 LiteLLM model routing and key storage did not become ready within ${seconds} seconds`,
		logs
	);
}
