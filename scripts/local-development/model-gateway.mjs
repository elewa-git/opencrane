import { runLocalCommand } from "./command-runner.mjs";

/** Waits for the local LiteLLM proxy to expose both model routing and database-backed key storage. */
export async function waitForLocalLiteLLM(configuration, secrets, operations = {})
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
		await delay();
	}

	const state = await runCommand("docker", [
		"inspect",
		"--format",
		"status={{.State.Status}} exit={{.State.ExitCode}} error={{.State.Error}}",
		configuration.liteLLMContainerName
	], { acceptFailure: true, signal: configuration.abortSignal });
	const stateDetail = state.status === 0 ? state.stdout.trim() : "container state unavailable";
	const seconds = attempts / 4;
	throw new Error(`Tier 2 LiteLLM model routing and key storage did not become ready within ${seconds} seconds (${stateDetail})`);
}
