import { AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, ___IsAgentRuntimeServiceAccountName, ___IsManagedAgentRuntimeServiceAccountName } from "@opencrane/contracts";

import { AgentRuntimeIdentityProfiles, type AgentRuntimeJobProfile } from "./agent-runtime-job.types.js";

/** Hard ceiling for non-authoritative runtime-local scratch. */
const _MAX_SCRATCH_BYTES = 1_073_741_824n;

/** Resolve the identity class a profile projects, defaulting to the personal runtime class. */
function _IdentityProfile(profile: AgentRuntimeJobProfile): AgentRuntimeIdentityProfiles
{
	return profile.identityProfile ?? AgentRuntimeIdentityProfiles.Personal;
}

/** Return whether a ServiceAccount name belongs to the profile's bounded identity class. */
function _IsIdentityServiceAccountName(profile: AgentRuntimeJobProfile, value: string): boolean
{
	return _IdentityProfile(profile) === AgentRuntimeIdentityProfiles.Managed ? ___IsManagedAgentRuntimeServiceAccountName(value) : ___IsAgentRuntimeServiceAccountName(value);
}

/** Reject blank or control-character-bearing authority coordinates. */
export function _IsBoundedAgentRuntimeCoordinate(value: string): boolean
{
	return value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Parse a positive binary Kubernetes storage quantity into bytes. */
function _ParseBinaryBytes(value: string): bigint | null
{
	const match = /^([1-9][0-9]*)(Ki|Mi|Gi|Ti|Pi|Ei)$/.exec(value);
	if (!match) return null;
	const exponent = { Ki: 1n, Mi: 2n, Gi: 3n, Ti: 4n, Pi: 5n, Ei: 6n }[match[2] as "Ki" | "Mi" | "Gi" | "Ti" | "Pi" | "Ei"];
	return BigInt(match[1]) * (1024n ** exponent);
}

/** Parse a positive Kubernetes CPU quantity into millicores. */
function _ParseCpuMillis(value: string): number | null
{
	const milli = /^([1-9][0-9]*)m$/.exec(value);
	const cores = /^([0-9]+(?:\.[0-9]+)?)$/.exec(value);
	let parsed = 0;
	if (milli) parsed = Number(milli[1]);
	else if (cores) parsed = Number(cores[1]) * 1000;
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Validate every deployment-owned runtime limit before the profile reaches Kubernetes.
 *
 * The checks keep an authority bug from widening network reach, selecting a moving image, mounting
 * unbounded scratch, or granting a per-user identity through a supposedly bounded profile.
 * @param profile - Immutable runtime policy supplied by the deployment.
 */
export function _AssertAgentRuntimeJobProfile(profile: AgentRuntimeJobProfile): void
{
	// 1. Pin the image and stream to the exact in-cluster endpoint the policy will admit.
	const streamUrl = URL.parse(profile.runtimeStreamUrl);
	if (!_IsBoundedAgentRuntimeCoordinate(profile.image) || !/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(profile.image) || !streamUrl || streamUrl.protocol !== "http:" || !streamUrl.hostname.endsWith(`.${profile.serverNamespace}.svc.cluster.local`) || streamUrl.pathname !== "/api/internal/agent-runtime" || streamUrl.search !== "" || streamUrl.hash !== "" || streamUrl.username !== "" || streamUrl.password !== "")
	{
		throw new Error("agent runtime profile requires an immutable image and an in-cluster HTTP stream URL");
	}
	if (!["Always", "IfNotPresent", "Never"].includes(profile.imagePullPolicy))
	{
		throw new Error("agent runtime profile requires a Kubernetes image pull policy");
	}

	// 2. Pin the LiteLLM proxy to an in-cluster endpoint reached only with the attempt-scoped key.
	const litellmUrl = URL.parse(profile.litellmBaseUrl);
	if (!litellmUrl || (litellmUrl.protocol !== "http:" && litellmUrl.protocol !== "https:") || !litellmUrl.hostname.endsWith(".svc.cluster.local") || litellmUrl.username !== "" || litellmUrl.password !== "" || litellmUrl.hash !== "")
	{
		throw new Error("agent runtime profile requires an in-cluster LiteLLM base URL");
	}

	// 3. Bind the profile to one server namespace and one mutually exclusive runtime identity class.
	if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(profile.serverNamespace) || profile.serverNamespace.length > 63 || !_IsIdentityServiceAccountName(profile, profile.serviceAccountName))
	{
		throw new Error("agent runtime profile requires one valid server namespace and bounded runtime ServiceAccount");
	}

	// 4. Require the projected-token and lifecycle bounds shared with deployment policy.
	if (!Number.isSafeInteger(profile.projectedTokenTtlSeconds) || profile.projectedTokenTtlSeconds < 600 || profile.projectedTokenTtlSeconds > 3600)
	{
		throw new Error("agent runtime projected-token TTL must be between 600 and 3600 seconds");
	}

	// 5. Bound transient storage, lifecycle, CPU, and memory before the manifest reaches an adapter.
	const scratchBytes = _ParseBinaryBytes(profile.scratchSize);
	if (!scratchBytes || scratchBytes > _MAX_SCRATCH_BYTES || !Number.isSafeInteger(profile.activeDeadlineSeconds) || profile.activeDeadlineSeconds < 1 || profile.ttlSecondsAfterFinished !== 0)
	{
		throw new Error("agent runtime profile requires bounded scratch, a finite deadline, and immediate terminal cleanup");
	}
	const requestedCpu = _ParseCpuMillis(String(profile.resources.requests?.cpu ?? ""));
	const limitedCpu = _ParseCpuMillis(String(profile.resources.limits?.cpu ?? ""));
	const requestedMemory = _ParseBinaryBytes(String(profile.resources.requests?.memory ?? ""));
	const limitedMemory = _ParseBinaryBytes(String(profile.resources.limits?.memory ?? ""));
	if (!requestedCpu || !limitedCpu || requestedCpu > limitedCpu || !requestedMemory || !limitedMemory || requestedMemory > limitedMemory)
	{
		throw new Error("agent runtime profile requires valid CPU and memory requests no greater than limits");
	}
}

/** Return the projected-token audience minted for one validated identity profile. */
export function _AgentRuntimeProjectedTokenAudience(profile: AgentRuntimeJobProfile): string
{
	return _IdentityProfile(profile) === AgentRuntimeIdentityProfiles.Managed ? MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE : AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE;
}
