import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { isAbsolute } from "node:path";

import type { WarmRuntimePodCandidate, WarmRuntimePodIdentity, WarmRuntimePoolProfile } from "@opencrane/backend/agents/runtime/k8s-launcher";
import { LocalAgentRuntimeModelStrategies } from "@opencrane/models/local-development";

import { _StartLocalWarmRuntime, _StopLocalWarmRuntime } from "./local-agent-runtime-process";
import type { LocalProcessWarmRuntimeStoreOptions, LocalWarmRuntime } from "./local-process-agent-controller-store.types";
import type { WarmRuntimeKubernetesStore, WarmRuntimeProfileActivation, WarmRuntimeReadinessEvidence } from "./warm-runtime-controller.types";

/** Resolve one configured local profile without accepting a foreign profile object. */
function _ProfileName(options: LocalProcessWarmRuntimeStoreOptions, profile: WarmRuntimePoolProfile): string
{
	for (const [name, configured] of Object.entries(options.profiles))
	{
		if (configured === profile)
		{
			return name;
		}
	}
	throw new Error("local warm runtime profile is not owned by this controller");
}

/** Return the exact runtime named by one workflow candidate. */
function _Runtime(runtimes: ReadonlyMap<string, LocalWarmRuntime>, candidate: WarmRuntimePodCandidate, profile: WarmRuntimePoolProfile): LocalWarmRuntime
{
	const runtime = runtimes.get(candidate.podUid);
	if (runtime === undefined || runtime.pool !== profile || runtime.candidate.podName !== candidate.podName || runtime.candidate.deploymentUid !== candidate.deploymentUid || runtime.candidate.resourceVersion !== candidate.resourceVersion)
	{
		throw new Error("local warm runtime candidate does not match this controller's synthetic pool");
	}
	return runtime;
}

/** Return the exact runtime named by a workflow lifecycle operation. */
function _RuntimeIdentity(runtimes: ReadonlyMap<string, LocalWarmRuntime>, identity: WarmRuntimePodIdentity, profile: WarmRuntimePoolProfile): LocalWarmRuntime | null
{
	const runtime = runtimes.get(identity.podUid);
	if (runtime === undefined)
	{
		return null;
	}
	if (runtime.pool !== profile || identity.namespace !== profile.namespace || identity.podName !== runtime.candidate.podName || identity.deploymentUid !== runtime.candidate.deploymentUid || identity.profile !== profile.claimedProfile)
	{
		throw new Error("local warm runtime identity does not match its synthetic pool");
	}
	return runtime;
}

/** Create one unclaimed synthetic Pod candidate for a fixed local pool. */
function _Candidate(profile: WarmRuntimePoolProfile, generation: number): WarmRuntimePodCandidate
{
	return { podName: `${profile.deploymentName}-local-${generation}`, podUid: randomUUID(), resourceVersion: "1", deploymentUid: randomUUID(), podIp: "127.0.0.1" };
}

/** Validate the local process and pool boundary before any child can start. */
function _ValidateOptions(options: LocalProcessWarmRuntimeStoreOptions): void
{
	const runtimeUrl = URL.parse(options.runtimeStreamUrl);
	const litellmUrl = options.litellmBaseUrl ? URL.parse(options.litellmBaseUrl) : null;
	const usesLiteLlm = options.modelStrategy === LocalAgentRuntimeModelStrategies.LiteLlm;
	const profiles = Object.values(options.profiles);
	const ports = new Set(profiles.map(function _Port(profile) { return profile.bindingPort; }));
	if (!isAbsolute(options.runtimeApplicationDirectory) || !isAbsolute(options.runtimeLaunchSecretPath) || !runtimeUrl || runtimeUrl.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(runtimeUrl.hostname) || (usesLiteLlm && (!litellmUrl || !["http:", "https:"].includes(litellmUrl.protocol))) || (!usesLiteLlm && options.litellmBaseUrl !== undefined) || profiles.length === 0 || ports.size !== profiles.length)
	{
		throw new Error("local warm runtime requires absolute paths, loopback control plane, strategy-matched model endpoint, and distinct binding ports");
	}
}

/** Create the Tier 2 process adapter for the 0.10 warm-runtime workflow. */
export function __CreateLocalProcessWarmRuntimeStore(options: LocalProcessWarmRuntimeStoreOptions): WarmRuntimeKubernetesStore
{
	_ValidateOptions(options);
	const runtimes = new Map<string, LocalWarmRuntime>();
	const generations = new Map<string, number>();
	const temporaryDirectoryRoot = options.temporaryDirectoryRoot ?? tmpdir();
	options.shutdownSignal.addEventListener("abort", function _StopAll(): void
	{
		for (const runtime of runtimes.values())
		{
			void _StopLocalWarmRuntime(runtime);
		}
	}, { once: true });
	return {
		async listGenericPods(profile)
		{
			const profileName = _ProfileName(options, profile);
			const existing = [...runtimes.values()].find(function _ForProfile(runtime) { return runtime.profileName === profileName; });
			if (existing !== undefined)
			{
				return existing.activationResourceVersion === undefined && existing.terminal !== true ? [structuredClone(existing.candidate)] : [];
			}
			const generation = (generations.get(profileName) ?? 0) + 1;
			generations.set(profileName, generation);
			const runtime: LocalWarmRuntime = { profileName, pool: profile, candidate: _Candidate(profile, generation) };
			runtimes.set(runtime.candidate.podUid, runtime);
			return [structuredClone(runtime.candidate)];
		},
		async activateProfile(candidate, profile): Promise<WarmRuntimeProfileActivation>
		{
			const runtime = _Runtime(runtimes, candidate, profile);
			if (runtime.activationResourceVersion !== undefined)
			{
				return { podUid: candidate.podUid, resourceVersion: runtime.activationResourceVersion, profile: profile.claimedProfile };
			}
			await _StartLocalWarmRuntime(options, runtime, temporaryDirectoryRoot);
			runtime.activationResourceVersion = "2";
			return { podUid: candidate.podUid, resourceVersion: "2", profile: profile.claimedProfile };
		},
		async proveReadiness(candidate, activation, profile): Promise<WarmRuntimeReadinessEvidence>
		{
			const runtime = _Runtime(runtimes, candidate, profile);
			if (activation.podUid !== candidate.podUid || activation.resourceVersion !== runtime.activationResourceVersion || activation.profile !== profile.claimedProfile)
			{
				throw new Error("local warm runtime activation evidence does not match the claimed process");
			}
			const fetchRequest = options.fetch ?? fetch;
			const response = await fetchRequest(`http://${candidate.podIp}:${profile.bindingPort}/internal/warm-runtime/readiness`, { headers: { "x-opencrane-pod-uid": candidate.podUid, "x-opencrane-runtime-profile": profile.claimedProfile }, signal: options.shutdownSignal });
			if (response.status !== 204)
			{
				throw new Error("local warm runtime readiness probe failed");
			}
			return { ...activation, observedAt: new Date().toISOString() };
		},
		async observeClaimedPod(identity, profile)
		{
			const runtime = _RuntimeIdentity(runtimes, identity, profile);
			if (runtime === null)
			{
				return "missing";
			}
			return runtime.terminal === true ? "terminal" : "running";
		},
		async deletePod(identity, profile): Promise<void>
		{
			const runtime = _RuntimeIdentity(runtimes, identity, profile);
			if (runtime === null)
			{
				return;
			}
			await _StopLocalWarmRuntime(runtime);
			runtimes.delete(identity.podUid);
		}
	};
}
