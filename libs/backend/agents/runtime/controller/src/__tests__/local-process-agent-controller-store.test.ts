import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { V1Secret } from "@kubernetes/client-node";
import { __BuildSuspendedAgentRuntimeJob } from "@opencrane/backend/agents/runtime/k8s-launcher";
import { afterEach, describe, expect, it, vi } from "vitest";

import { __CreateLocalProcessAgentControllerStore } from "../local-process-agent-controller-store";
import { __CreateLocalAgentRuntimeTokenReviewer } from "../local-agent-runtime-token";
import { LocalAgentRuntimeModelStrategies, type LocalAgentRuntimeSpawnOptions } from "../local-process-agent-controller-store.types";

/** Temporary directories removed after each local workload-host test. */
const _temporaryDirectories: string[] = [];

/** Build the unchanged Kubernetes Job projection consumed by the local replacement host. */
function _ExpectedJob()
{
	return __BuildSuspendedAgentRuntimeJob({
		runId: "run-local-1",
		attempt: 1,
		agentServiceId: "service-1",
		agentRevisionId: "revision-1",
		siloId: "silo-1",
		namespace: "local-development-personal-runtime",
		bootstrapReference: "bootstrap-local-1",
		litellmKeySecretName: "attempt-key-local-1"
	}, {
		image: "local-agent-runtime@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		imagePullPolicy: "Never",
		runtimeStreamUrl: "http://opencrane.local-development-server.svc.cluster.local/api/internal/agent-runtime",
		litellmBaseUrl: "http://litellm.local-development-server.svc.cluster.local:4000",
		serverNamespace: "local-development-server",
		serviceAccountName: "agent-runtime-default",
		projectedTokenTtlSeconds: 600,
		scratchSize: "64Mi",
		activeDeadlineSeconds: 900,
		ttlSecondsAfterFinished: 0,
		resources: {
			requests: {
				cpu: "25m",
				memory: "64Mi"
			},
			limits: {
				cpu: "250m",
				memory: "128Mi"
			}
		}
	});
}

/** Build the create-only key projection owned by the prepared workload. */
function _AttemptKeySecret(workloadUid: string, key: string): V1Secret
{
	return {
		metadata: {
			name: "attempt-key-local-1",
			ownerReferences: [{
				apiVersion: "batch/v1",
				kind: "Job",
				name: "local-job",
				uid: workloadUid,
				controller: true
			}]
		},
		stringData: { key }
	};
}

/** Create a controllable ChildProcess stand-in without starting Python. */
function _Process(): ChildProcess
{
	const processHandle = new EventEmitter() as ChildProcess;
	Object.defineProperty(processHandle, "killed", { value: false, writable: true });
	Object.defineProperty(processHandle, "pid", { value: 12345 });
	processHandle.kill = vi.fn(function _Kill(): boolean
	{
		Object.defineProperty(processHandle, "killed", { value: true, writable: true });
		return true;
	});
	return processHandle;
}

afterEach(async function _CleanTemporaryDirectories()
{
	vi.useRealTimers();
	await Promise.all(_temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe("local process Agent controller store", function _Suite()
{
	it("projects private files and starts the existing runtime with no inherited credentials", async function _StartsPrivateAttempt()
	{
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-24T08:00:00.000Z"));
		const root = await mkdtemp(join(tmpdir(), "opencrane-local-store-test-"));
		_temporaryDirectories.push(root);
		const runtimeLaunchSecretPath = join(root, "runtime-launch.secret");
		await writeFile(runtimeLaunchSecretPath, "local-runtime-launch-secret-with-32-characters", { mode: 0o600 });
		const spawned: LocalAgentRuntimeSpawnOptions[] = [];
		const processHandle = _Process();
		const shutdown = new AbortController();
		const store = __CreateLocalProcessAgentControllerStore({
			runtimeApplicationDirectory: "/workspace/opencrane/apps/agent-runtime",
			pythonExecutable: "python3",
			runtimeStreamUrl: "http://127.0.0.1:3001/api/internal/agent-runtime",
			litellmBaseUrl: "http://127.0.0.1:4000",
			runtimeLaunchSecretPath,
			modelStrategy: LocalAgentRuntimeModelStrategies.LiteLlm,
			shutdownSignal: shutdown.signal,
			temporaryDirectoryRoot: root,
			spawnProcess(_executable, _arguments, options)
			{
				spawned.push(options);
				return processHandle;
			}
		});
		const expected = _ExpectedJob();
		const prepared = await store.__EnsureSuspendedJob(expected);
		const workloadUid = prepared.metadata?.uid ?? "";
		await store.__EnsureAttemptKeySecret(_AttemptKeySecret(workloadUid, "sk-attempt-local"));

		const released = await store.__EnsureRuntimeJobReleased(expected, workloadUid, "2026-08-24T08:10:00.000Z", "2026-08-24T08:01:00.000Z");
		const pod = await store.__FindFirstRuntimePod(expected, workloadUid, "agent-runtime-default");

		expect(released.spec?.suspend).toBe(false);
		expect(pod?.metadata?.uid).toBeTruthy();
		expect(spawned).toHaveLength(1);
		const environment = spawned[0].env;
		expect(Object.keys(environment).sort()).toEqual([
			"OPENCRANE_RUNTIME_BOOTSTRAP_PATH",
			"OPENCRANE_RUNTIME_CHECKPOINT_DIR",
			"OPENCRANE_RUNTIME_LITELLM_BASE_URL",
			"OPENCRANE_RUNTIME_LITELLM_KEY_PATH",
			"OPENCRANE_RUNTIME_MODEL_STRATEGY",
			"OPENCRANE_RUNTIME_STREAM_URL",
			"OPENCRANE_RUNTIME_TOKEN_PATH",
			"PATH",
			"POD_UID",
			"PYTHONUNBUFFERED"
		].sort());
		expect(JSON.stringify(environment)).not.toContain("local-runtime-launch-secret");
		expect(JSON.stringify(environment)).not.toContain("sk-attempt-local");
		const tokenPath = environment.OPENCRANE_RUNTIME_TOKEN_PATH;
		const bootstrapPath = environment.OPENCRANE_RUNTIME_BOOTSTRAP_PATH;
		const keyPath = environment.OPENCRANE_RUNTIME_LITELLM_KEY_PATH;
		expect((await stat(tokenPath)).mode & 0o777).toBe(0o600);
		expect((await stat(bootstrapPath)).mode & 0o777).toBe(0o600);
		expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
		const signedToken = await readFile(tokenPath, "utf8");
		const reviewer = __CreateLocalAgentRuntimeTokenReviewer({
			launchSecretPath: runtimeLaunchSecretPath,
			namespace: "local-development-personal-runtime",
			serviceAccountName: "agent-runtime-default"
		});
		expect(await reviewer.__Review(signedToken)).toEqual({
			subject: "system:serviceaccount:local-development-personal-runtime:agent-runtime-default",
			namespace: "local-development-personal-runtime",
			serviceAccountName: "agent-runtime-default",
			podUid: pod?.metadata?.uid
		});
		expect(await reviewer.__Review(`${signedToken}x`)).toBeNull();
		const wrongNamespace = __CreateLocalAgentRuntimeTokenReviewer({
			launchSecretPath: runtimeLaunchSecretPath,
			namespace: "other-runtime",
			serviceAccountName: "agent-runtime-default"
		});
		expect(await wrongNamespace.__Review(signedToken)).toBeNull();
		expect(await readFile(bootstrapPath, "utf8")).toBe("bootstrap-local-1");
		expect(await readFile(keyPath, "utf8")).toBe("sk-attempt-local");

		shutdown.abort();
		expect(processHandle.kill).toHaveBeenCalledWith("SIGTERM");
	});

	it("refuses a different key on an idempotent attempt replay", async function _RejectsKeyDrift()
	{
		const root = await mkdtemp(join(tmpdir(), "opencrane-local-store-test-"));
		_temporaryDirectories.push(root);
		const runtimeLaunchSecretPath = join(root, "runtime-launch.secret");
		await writeFile(runtimeLaunchSecretPath, "local-runtime-launch-secret-with-32-characters", { mode: 0o600 });
		const spawned: LocalAgentRuntimeSpawnOptions[] = [];
		const store = __CreateLocalProcessAgentControllerStore({
			runtimeApplicationDirectory: "/workspace/opencrane/apps/agent-runtime",
			pythonExecutable: "python3",
			runtimeStreamUrl: "http://127.0.0.1:3001/api/internal/agent-runtime",
			litellmBaseUrl: "http://127.0.0.1:4000",
			runtimeLaunchSecretPath,
			modelStrategy: LocalAgentRuntimeModelStrategies.LiteLlm,
			shutdownSignal: new AbortController().signal,
			temporaryDirectoryRoot: root,
			spawnProcess(_executable, _arguments, options)
			{
				spawned.push(options);
				return _Process();
			}
		});
		const expected = _ExpectedJob();
		const prepared = await store.__EnsureSuspendedJob(expected);
		const workloadUid = prepared.metadata?.uid ?? "";
		await store.__EnsureAttemptKeySecret(_AttemptKeySecret(workloadUid, "first-key"));

		await expect(store.__EnsureAttemptKeySecret(_AttemptKeySecret(workloadUid, "different-key"))).rejects.toThrow(/different key/);
		const now = Date.now();
		await store.__EnsureRuntimeJobReleased(expected, workloadUid, new Date(now + 600_000).toISOString(), new Date(now + 60_000).toISOString());
		expect(spawned[0].env.OPENCRANE_RUNTIME_LITELLM_BASE_URL).toBe("http://127.0.0.1:4000");
		expect(spawned[0].env.OPENCRANE_RUNTIME_LITELLM_KEY_PATH).toContain("litellm.key");
	});

	it("does not write an attempt-key file for simulated model output", async function _OmitsSimulatedKey()
	{
		const root = await mkdtemp(join(tmpdir(), "opencrane-local-store-test-"));
		_temporaryDirectories.push(root);
		const runtimeLaunchSecretPath = join(root, "runtime-launch.secret");
		await writeFile(runtimeLaunchSecretPath, "local-runtime-launch-secret-with-32-characters", { mode: 0o600 });
		const store = __CreateLocalProcessAgentControllerStore({
			runtimeApplicationDirectory: "/workspace/opencrane/apps/agent-runtime",
			pythonExecutable: "python3",
			runtimeStreamUrl: "http://127.0.0.1:3001/api/internal/agent-runtime",
			runtimeLaunchSecretPath,
			modelStrategy: LocalAgentRuntimeModelStrategies.Simulated,
			shutdownSignal: new AbortController().signal,
			temporaryDirectoryRoot: root
		});
		const prepared = await store.__EnsureSuspendedJob(_ExpectedJob());
		const workloadUid = prepared.metadata?.uid ?? "";
		await store.__EnsureAttemptKeySecret(_AttemptKeySecret(workloadUid, "unused-key"));
		const attemptDirectory = (await readdir(root)).find(name => name.startsWith("opencrane-agent-runtime-"));

		expect(attemptDirectory).toBeTruthy();
		await expect(access(join(root, attemptDirectory ?? "", "litellm.key"))).rejects.toMatchObject({ code: "ENOENT" });
	});
});
