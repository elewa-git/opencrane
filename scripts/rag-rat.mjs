import { fileURLToPath } from "node:url";

import { ___RunAgentContextProcess } from "./rag-rat/process.mjs";
import { ___EnsureRagRatRuntime } from "./rag-rat/runtime.mjs";
import { ___RunRagRatWorkflow } from "./rag-rat/workflows.mjs";

const _REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const _RUNTIME_PARENT = fileURLToPath(new URL("../.rag-rat/runtime", import.meta.url));
let _VerifiedExecutable;

function _RunProcess(command, arguments_)
{
	return ___RunAgentContextProcess(command, arguments_, {
		cwd: _REPOSITORY_ROOT,
		env: process.env,
	});
}

function _RunRagRat(arguments_)
{
	if (!_VerifiedExecutable)
	{
		const runtime = ___EnsureRagRatRuntime({
			architecture: process.arch,
			nodeExecutable: process.execPath,
			npmExecPath: process.env.npm_execpath,
			platform: process.platform,
			runInstaller: _RunProcess,
			runtimeParent: _RUNTIME_PARENT,
		});

		if (runtime.status !== 0 || !runtime.executable)
		{
			console.error(runtime.errorMessage ?? "Could not prepare the reviewed rag-rat runtime.");
			return runtime.status || 1;
		}

		_VerifiedExecutable = runtime.executable;
	}

	const result = _RunProcess(_VerifiedExecutable, arguments_);
	if (result.errorMessage)
	{
		console.error(`Could not start rag-rat: ${result.errorMessage}`);
	}

	return result.status;
}

const [command, ...arguments_] = process.argv.slice(2);
process.exitCode = ___RunRagRatWorkflow(command, arguments_, _RunRagRat);
