import { runLocalCommand } from "./command-runner.mjs";

/** Waits for the local LiteLLM proxy to accept an authenticated model-catalogue request. */
export async function waitForLocalLiteLLM(configuration, secrets, operations = {})
{
	const runCommand = operations.runCommand ?? runLocalCommand;
	const delay = operations.delay ?? function _Delay() { return new Promise(function _Wait(resolve) { setTimeout(resolve, 250); }); };
	for (let attempt = 0; attempt < 120; attempt += 1)
	{
		configuration.abortSignal?.throwIfAborted();
		const result = await runCommand("curl", [
			"--silent", "--show-error", "--fail", "--output", "/dev/null",
			"--header", `@${secrets.liteLLMMasterAuthorizationHeaderPath}`,
			`http://127.0.0.1:${configuration.liteLLMPort}/v1/models`
		], { acceptFailure: true, signal: configuration.abortSignal });
		if (result.status === 0)
		{
			return;
		}
		await delay();
	}
	throw new Error("Tier 2 LiteLLM did not become ready within 30 seconds");
}
