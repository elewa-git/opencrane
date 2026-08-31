import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { LocalAgentRuntimeModelStrategies } from "@opencrane/models/local-development";
import { afterEach, describe, expect, it, vi } from "vitest";

import { __CreateLocalAgentRuntimeTokenReviewer } from "../local-agent-runtime-token";
import { __CreateLocalProcessWarmRuntimeStore } from "../local-process-agent-controller-store";
import type { LocalAgentRuntimeSpawnOptions } from "../local-process-agent-controller-store.types";
import type { WarmRuntimePoolProfiles } from "../warm-runtime-controller.types";

const _temporaryDirectories: string[] = [];

/** Return the two local pools with distinct loopback listener ports. */
function _Profiles(): WarmRuntimePoolProfiles
{
	function _Profile(name: string, namespace: string, serviceAccountName: string, bindingPort: number)
	{
		return { namespace, deploymentName: `local-${name}-warm`, serviceAccountName, genericProfile: "generic", claimedProfile: name, image: `local-runtime@sha256:${"a".repeat(64)}`, imagePullPolicy: "Never" as const, bindingPort, genericIdleSeconds: 900, scratchSize: "64Mi", resources: { requests: { cpu: "25m", memory: "64Mi" }, limits: { cpu: "250m", memory: "128Mi" } } };
	}
	return {
		"personal-default": _Profile("personal", "local-personal-runtime", "agent-runtime-default", 18_081),
		"managed-default": _Profile("managed", "local-managed-runtime", "managed-agent-runtime-default", 18_082)
	};
}

/** Create a controllable ChildProcess stand-in without starting Python. */
function _Process(): ChildProcess
{
	const processHandle = new EventEmitter() as ChildProcess;
	Object.defineProperty(processHandle, "killed", { value: false, writable: true });
	Object.defineProperty(processHandle, "pid", { value: 12345 });
	processHandle.kill = vi.fn(function _Kill(): boolean { Object.defineProperty(processHandle, "killed", { value: true, writable: true }); return true; });
	return processHandle;
}

afterEach(async function _CleanTemporaryDirectories()
{
	await Promise.all(_temporaryDirectories.splice(0).map(function _Remove(path) { return rm(path, { recursive: true, force: true }); }));
});

describe("local process warm-runtime store", function _Suite()
{
	it("starts only a reserved synthetic Pod with private identity files", async function _StartsClaimedRuntime()
	{
		const root = await mkdtemp(join(tmpdir(), "opencrane-local-warm-test-"));
		_temporaryDirectories.push(root);
		const runtimeLaunchSecretPath = join(root, "runtime-launch.secret");
		await writeFile(runtimeLaunchSecretPath, "local-runtime-launch-secret-with-32-characters", { mode: 0o600 });
		const spawned: LocalAgentRuntimeSpawnOptions[] = [];
		const processHandle = _Process();
		const shutdown = new AbortController();
		const profiles = _Profiles();
		const store = __CreateLocalProcessWarmRuntimeStore({
			runtimeApplicationDirectory: "/workspace/opencrane/apps/agent-runtime",
			pythonExecutable: "python3",
			runtimeStreamUrl: "http://127.0.0.1:8081/api/internal/warm-runtime",
			litellmBaseUrl: "http://127.0.0.1:4000",
			runtimeLaunchSecretPath,
			modelStrategy: LocalAgentRuntimeModelStrategies.LiteLlm,
			profiles,
			shutdownSignal: shutdown.signal,
			temporaryDirectoryRoot: root,
			spawnProcess(_executable, _arguments, options) { spawned.push(options); return processHandle; },
			fetch: vi.fn(async function _Ready() { return new Response(null, { status: 204 }); })
		});
		const profile = profiles["personal-default"]!;
		const [candidate] = await store.listGenericPods(profile);
		expect(spawned).toHaveLength(0);
		const activation = await store.activateProfile(candidate!, profile);
		await expect(store.proveReadiness(candidate!, activation, profile)).resolves.toMatchObject({ podUid: candidate!.podUid, profile: "personal" });
		expect(spawned).toHaveLength(1);
		const environment = spawned[0]!.env;
		expect(Object.keys(environment).sort()).toEqual(["OPENCRANE_RUNTIME_LITELLM_BASE_URL", "OPENCRANE_RUNTIME_MODEL_STRATEGY", "OPENCRANE_RUNTIME_PROOF_EVIDENCE_PATH", "OPENCRANE_RUNTIME_STREAM_URL", "OPENCRANE_RUNTIME_TOKEN_PATH", "OPENCRANE_WARM_BINDING_PORT", "OPENCRANE_WARM_PROFILE", "PATH", "POD_UID", "PYTHONUNBUFFERED"].sort());
		expect(JSON.stringify(environment)).not.toContain("local-runtime-launch-secret");
		expect((await stat(environment.OPENCRANE_RUNTIME_TOKEN_PATH!)).mode & 0o777).toBe(0o600);
		const reviewer = __CreateLocalAgentRuntimeTokenReviewer({ launchSecretPath: runtimeLaunchSecretPath, namespace: profile.namespace, serviceAccountName: profile.serviceAccountName });
		expect(await reviewer.__Review(await readFile(environment.OPENCRANE_RUNTIME_TOKEN_PATH!, "utf8"))).toMatchObject({ namespace: profile.namespace, serviceAccountName: profile.serviceAccountName, podUid: candidate!.podUid });
		await store.deletePod({ namespace: profile.namespace, podName: candidate!.podName, podUid: candidate!.podUid, deploymentUid: candidate!.deploymentUid, profile: profile.claimedProfile }, profile);
		expect(processHandle.kill).toHaveBeenCalledWith("SIGTERM");
		expect(await store.listGenericPods(profile)).toHaveLength(1);
	});

	it("omits every model endpoint from simulated runtime processes", async function _SimulatedBoundary()
	{
		const root = await mkdtemp(join(tmpdir(), "opencrane-local-warm-test-"));
		_temporaryDirectories.push(root);
		const runtimeLaunchSecretPath = join(root, "runtime-launch.secret");
		await writeFile(runtimeLaunchSecretPath, "local-runtime-launch-secret-with-32-characters", { mode: 0o600 });
		let environment: Readonly<Record<string, string>> | undefined;
		const profiles = _Profiles();
		const store = __CreateLocalProcessWarmRuntimeStore({ runtimeApplicationDirectory: "/workspace/opencrane/apps/agent-runtime", pythonExecutable: "python3", runtimeStreamUrl: "http://127.0.0.1:8081/api/internal/warm-runtime", runtimeLaunchSecretPath, modelStrategy: LocalAgentRuntimeModelStrategies.Simulated, profiles, shutdownSignal: new AbortController().signal, temporaryDirectoryRoot: root, spawnProcess(_executable, _arguments, options) { environment = options.env; return _Process(); } });
		const profile = profiles["personal-default"]!;
		const [candidate] = await store.listGenericPods(profile);
		await store.activateProfile(candidate!, profile);
		expect(environment?.OPENCRANE_RUNTIME_LITELLM_BASE_URL).toBeUndefined();
	});
});
