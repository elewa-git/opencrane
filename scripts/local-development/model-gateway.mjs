import { runLocalCommand } from "./command-runner.mjs";

/** Waits for the local LiteLLM proxy to expose both model routing and database-backed key storage. */
export async function waitForLocalLiteLLM(configuration, secrets, operations = {})
{
	const runCommand = operations.runCommand ?? runLocalCommand;
	const delay = operations.delay ?? function _Delay() { return new Promise(function _Wait(resolve) { setTimeout(resolve, 250); }); };
	const paths = ["/v1/models", "/key/list"];
	for (let attempt = 0; attempt < 120; attempt += 1)
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
	throw new Error("Tier 2 LiteLLM model routing and key storage did not become ready within 30 seconds");
}
