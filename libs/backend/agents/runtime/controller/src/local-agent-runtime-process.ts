import { type ChildProcess, spawn } from "node:child_process";
import { rm } from "node:fs/promises";

import { LocalAgentRuntimeModelStrategies } from "@opencrane/models/local-development";

import { _CreateLocalAgentRuntimeFiles, _WriteLocalAgentRuntimeToken } from "./local-agent-runtime-files";
import { _CreateLocalAgentRuntimeToken } from "./local-agent-runtime-token";
import type { LocalAgentRuntimeProcessSpawner, LocalAgentRuntimeSpawnOptions, LocalProcessWarmRuntimeStoreOptions, LocalWarmRuntime } from "./local-process-agent-controller-store.types";

/** Builds the allowlisted environment for one claimed local warm runtime. */
function _RuntimeEnvironment(options: LocalProcessWarmRuntimeStoreOptions, runtime: LocalWarmRuntime): Readonly<Record<string, string>>
{
	if (runtime.files === undefined)
	{
		throw new Error("local warm runtime files must exist before process launch");
	}
	const environment: Record<string, string> = {
		PATH: process.env.PATH ?? "/usr/bin:/bin",
		PYTHONUNBUFFERED: "1",
		OPENCRANE_RUNTIME_STREAM_URL: options.runtimeStreamUrl,
		OPENCRANE_RUNTIME_TOKEN_PATH: runtime.files.tokenPath,
		OPENCRANE_RUNTIME_PROOF_EVIDENCE_PATH: runtime.files.proofEvidencePath,
		OPENCRANE_RUNTIME_MODEL_STRATEGY: options.modelStrategy,
		OPENCRANE_WARM_BINDING_PORT: String(runtime.pool.bindingPort),
		OPENCRANE_WARM_PROFILE: runtime.pool.claimedProfile,
		POD_UID: runtime.candidate.podUid
	};
	if (options.modelStrategy === LocalAgentRuntimeModelStrategies.LiteLlm && options.litellmBaseUrl)
	{
		environment.OPENCRANE_RUNTIME_LITELLM_BASE_URL = options.litellmBaseUrl;
	}
	return environment;
}

/** Adapt Node's launcher to the narrow injectable development seam. */
function _SpawnProcess(executable: string, arguments_: readonly string[], options: LocalAgentRuntimeSpawnOptions): ChildProcess
{
	return spawn(executable, [...arguments_], { cwd: options.cwd, env: { ...options.env }, stdio: options.stdio });
}

/** Wait until the operating system accepts the process before returning activation evidence. */
async function _WaitForProcessStart(processHandle: ChildProcess): Promise<void>
{
	if (typeof processHandle.pid === "number")
	{
		return;
	}
	await new Promise<void>(function _Wait(resolve, reject)
	{
		function _Started(): void { processHandle.removeListener("error", _Failed); resolve(); }
		function _Failed(err: Error): void { processHandle.removeListener("spawn", _Started); reject(err); }
		processHandle.once("spawn", _Started);
		processHandle.once("error", _Failed);
	});
}

/** Start one claimed local runtime after the workflow has saved its synthetic Pod reservation. */
export async function _StartLocalWarmRuntime(options: LocalProcessWarmRuntimeStoreOptions, runtime: LocalWarmRuntime, temporaryDirectoryRoot: string): Promise<void>
{
	if (runtime.process !== undefined)
	{
		return;
	}
	const files = await _CreateLocalAgentRuntimeFiles(temporaryDirectoryRoot);
	runtime.files = files;
	const token = await _CreateLocalAgentRuntimeToken({ launchSecretPath: options.runtimeLaunchSecretPath, namespace: runtime.pool.namespace, serviceAccountName: runtime.pool.serviceAccountName }, runtime.candidate.podUid);
	await _WriteLocalAgentRuntimeToken(files, token);
	const spawnProcess: LocalAgentRuntimeProcessSpawner = options.spawnProcess ?? _SpawnProcess;
	const processHandle = spawnProcess(options.pythonExecutable, ["-B", "-m", "src.development_runtime"], { cwd: options.runtimeApplicationDirectory, env: _RuntimeEnvironment(options, runtime), stdio: "inherit" });
	await _WaitForProcessStart(processHandle);
	runtime.process = processHandle;
	processHandle.once("exit", function _RecordTerminal(): void { runtime.terminal = true; });
}

/** Stop one synthetic Pod and remove its private files. */
export async function _StopLocalWarmRuntime(runtime: LocalWarmRuntime): Promise<void>
{
	if (runtime.process !== undefined && !runtime.process.killed)
	{
		runtime.process.kill("SIGTERM");
	}
	if (runtime.files !== undefined)
	{
		await rm(runtime.files.directory, { recursive: true, force: true });
	}
}
