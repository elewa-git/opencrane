import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import type { V1Job, V1Pod } from "@kubernetes/client-node";
import { __DeriveAgentRuntimeReleaseDeadlineSeconds } from "@opencrane/backend/agents/runtime/k8s-launcher";
import { LocalAgentRuntimeModelStrategies } from "@opencrane/models/local-development";

import { _AssertExactFirstAgentRuntimePod } from "./kubernetes-runtime-pod";
import { _WriteLocalAgentRuntimeToken } from "./local-agent-runtime-files";
import { _CreateLocalAgentRuntimeToken } from "./local-agent-runtime-token";
import type { LocalAgentRuntimeAttempt, LocalAgentRuntimeProcessSpawner, LocalAgentRuntimeSpawnOptions, LocalProcessAgentControllerStoreOptions } from "./local-process-agent-controller-store.types";

/** Build the synthetic Pod evidence registered through existing runtime authority. */
function _LocalRuntimePod(job: V1Job, workloadUid: string, podUid: string): V1Pod
{
	const name = job.metadata?.name;
	const namespace = job.metadata?.namespace;
	const template = job.spec?.template;

	if (!name || !namespace || !template?.metadata?.labels || !template.spec)
	{
		throw new Error("local agent runtime requires the complete admitted Pod projection");
	}

	return {
		apiVersion: "v1",
		kind: "Pod",
		metadata: {
			name: `${name}-local`,
			namespace,
			uid: podUid,
			labels: {
				...template.metadata.labels,
				"batch.kubernetes.io/controller-uid": workloadUid,
				"batch.kubernetes.io/job-name": name,
				"controller-uid": workloadUid,
				"job-name": name
			},
			ownerReferences: [{
				apiVersion: "batch/v1",
				kind: "Job",
				name,
				uid: workloadUid,
				controller: true,
				blockOwnerDeletion: true
			}]
		},
		spec: structuredClone(template.spec)
	};
}

/** Build the credential-free environment passed to the existing Python runtime. */
function _RuntimeEnvironment(options: LocalProcessAgentControllerStoreOptions, attempt: LocalAgentRuntimeAttempt, podUid: string): Readonly<Record<string, string>>
{
	const environment: Record<string, string> = {
		PATH: process.env.PATH ?? "/usr/bin:/bin",
		PYTHONUNBUFFERED: "1",
		OPENCRANE_RUNTIME_STREAM_URL: options.runtimeStreamUrl,
		OPENCRANE_RUNTIME_TOKEN_PATH: attempt.files.tokenPath,
		OPENCRANE_RUNTIME_BOOTSTRAP_PATH: attempt.files.bootstrapPath,
		OPENCRANE_RUNTIME_MODEL_STRATEGY: options.modelStrategy,
		OPENCRANE_RUNTIME_CHECKPOINT_DIR: join(attempt.files.directory, "checkpoints"),
		POD_UID: podUid
	};

	if (options.modelStrategy === LocalAgentRuntimeModelStrategies.LiteLlm && options.litellmBaseUrl)
	{
		environment.OPENCRANE_RUNTIME_LITELLM_BASE_URL = options.litellmBaseUrl;
		environment.OPENCRANE_RUNTIME_LITELLM_KEY_PATH = attempt.files.keyPath;
	}

	return environment;
}

/** Adapt Node's launcher to the narrow injectable development seam. */
function _SpawnProcess(executable: string, arguments_: readonly string[], options: LocalAgentRuntimeSpawnOptions): ChildProcess
{
	return spawn(executable, [...arguments_], {
		cwd: options.cwd,
		env: { ...options.env },
		stdio: options.stdio
	});
}

/** Wait until the operating system accepts the process before projecting Pod evidence. */
async function _WaitForProcessStart(processHandle: ChildProcess): Promise<void>
{
	if (typeof processHandle.pid === "number")
	{
		return;
	}

	await new Promise<void>(function _waitForProcessStart(resolve, reject)
	{
		/** Resolves after the operating system accepts the child process. */
		function _Started(): void { processHandle.removeListener("error", _Failed); resolve(); }
		/** Rejects without projecting a Pod when the executable cannot start. */
		function _Failed(err: Error): void { processHandle.removeListener("spawn", _Started); reject(err); }
		processHandle.once("spawn", _Started);
		processHandle.once("error", _Failed);
	});
}

/** Stop one local attempt and remove private files after the process no longer needs them. */
export async function _StopLocalAgentRuntimeAttempt(attempt: LocalAgentRuntimeAttempt): Promise<void>
{
	if (attempt.deadline)
	{
		clearTimeout(attempt.deadline);
	}

	if (attempt.process && !attempt.process.killed)
	{
		attempt.process.kill("SIGTERM");
	}

	await rm(attempt.files.directory, { recursive: true, force: true });
}

/** Release one prepared attempt by starting the existing development runtime entrypoint. */
export async function _ReleaseLocalAgentRuntimeAttempt(options: LocalProcessAgentControllerStoreOptions, attempt: LocalAgentRuntimeAttempt, expected: V1Job, assignmentExpiresAt: string, releaseLeaseExpiresAt: string): Promise<V1Job>
{
	if (attempt.process)
	{
		return structuredClone(attempt.job);
	}

	const currentSpec = attempt.job.spec;

	if (!currentSpec)
	{
		throw new Error("local agent runtime requires the admitted Job specification");
	}

	await mkdir(join(attempt.files.directory, "checkpoints"), { mode: 0o700 });
	const authorityUpperBound = Math.max(Date.now(), Date.parse(releaseLeaseExpiresAt));
	const deadlineSeconds = __DeriveAgentRuntimeReleaseDeadlineSeconds(assignmentExpiresAt, authorityUpperBound, expected.spec?.activeDeadlineSeconds ?? 0);
	const pod = _LocalRuntimePod(expected, attempt.workloadUid, randomUUID());
	const serviceAccountName = expected.spec?.template.spec?.serviceAccountName ?? "";
	_AssertExactFirstAgentRuntimePod(pod, expected, attempt.workloadUid, serviceAccountName);
	const runtimeToken = await _CreateLocalAgentRuntimeToken({
		launchSecretPath: options.runtimeLaunchSecretPath,
		namespace: expected.metadata?.namespace ?? "",
		serviceAccountName
	}, pod.metadata?.uid ?? "");
	await _WriteLocalAgentRuntimeToken(attempt.files, runtimeToken);
	const spawnProcess: LocalAgentRuntimeProcessSpawner = options.spawnProcess ?? _SpawnProcess;
	const processHandle = spawnProcess(options.pythonExecutable, ["-B", "-m", "src.development_runtime"], {
		cwd: options.runtimeApplicationDirectory,
		env: _RuntimeEnvironment(options, attempt, pod.metadata?.uid ?? ""),
		stdio: "inherit"
	});
	await _WaitForProcessStart(processHandle);
	const releasedJob: V1Job = {
		...attempt.job,
		spec: {
			...currentSpec,
			suspend: false,
			activeDeadlineSeconds: deadlineSeconds
		}
	};
	attempt.job = releasedJob;
	attempt.pod = pod;
	attempt.process = processHandle;
	/** Stops the child when its admitted deadline expires. */
	function _StopExpiredAttempt(): void { processHandle.kill("SIGTERM"); }
	/** Removes attempt credentials after the child exits. */
	function _CleanExitedAttempt(): void { void _StopLocalAgentRuntimeAttempt(attempt); }
	attempt.deadline = setTimeout(_StopExpiredAttempt, deadlineSeconds * 1_000);
	processHandle.once("exit", _CleanExitedAttempt);
	return structuredClone(releasedJob);
}
