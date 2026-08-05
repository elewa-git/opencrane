import { __BuildSuspendedAgentRuntimeJob } from "@opencrane/backend/agents/runtime/k8s-launcher";

import type { AgentControllerRuntimeProfile, AgentControllerRuntimeProfiles } from "./agent-controller.types.js";

/** Validate a DNS-label namespace before it becomes a Kubernetes authority boundary. */
function _IsNamespace(value: string): boolean
{
	return value.length <= 63 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value);
}

/** Resolve one exact configured profile without accepting prototype properties. */
export function _ResolveAgentControllerRuntimeProfile(profiles: AgentControllerRuntimeProfiles, name: string): AgentControllerRuntimeProfile | undefined
{
	if (!Object.prototype.hasOwnProperty.call(profiles, name))
	{
		throw new Error(`agent controller has no configured runtime profile '${name}'`);
	}
	return profiles[name];
}

/**
 * Validate every deployment-supplied runtime profile through the canonical manifest builder.
 * @param value - Parsed JSON map whose values are candidate immutable runtime profiles.
 * @returns Detached, validated runtime-profile map.
 */
export function __ValidateAgentControllerRuntimeProfiles(value: unknown): AgentControllerRuntimeProfiles
{
	if (typeof value !== "object" || value === null || Array.isArray(value))
	{
		throw new Error("agent controller profiles must be one bounded object");
	}
	const entries = Object.entries(value);
	if (entries.length === 0 || entries.length > 32)
	{
		throw new Error("agent controller requires between 1 and 32 bounded runtime profiles");
	}
	const profiles: Record<string, AgentControllerRuntimeProfile> = Object.create(null) as Record<string, AgentControllerRuntimeProfile>;
	const namespaces = new Set<string>();
	for (const [name, candidate] of entries)
	{
		if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name) || name.length > 63 || typeof candidate !== "object" || candidate === null || Array.isArray(candidate))
		{
			throw new Error("agent controller profile names and bodies must be bounded objects");
		}
		const profile = structuredClone(candidate) as AgentControllerRuntimeProfile;
		if (!_IsNamespace(profile.namespace) || profile.serverNamespace === profile.namespace || namespaces.has(profile.namespace))
		{
			throw new Error(`agent controller profile '${name}' must own one unique runtime namespace separate from its server namespace`);
		}
		__BuildSuspendedAgentRuntimeJob({ runId: "profile-validation", attempt: 1, agentServiceId: "profile-validation", agentRevisionId: "profile-validation", siloId: "profile-validation", namespace: profile.namespace, bootstrapReference: "profile-validation", litellmKeySecretName: "litellm-key-profilevalidation" }, profile);
		namespaces.add(profile.namespace);
		profiles[name] = profile;
	}
	return profiles;
}

/** Return whether every configured profile owns one distinct namespace outside its server. */
export function _AgentControllerProfilesAreBoundToDistinctNamespaces(profiles: AgentControllerRuntimeProfiles): boolean
{
	const values = Object.values(profiles);
	const namespaces = new Set(values.map(function _namespace(profile): string { return profile.namespace; }));
	return values.length > 0 && values.every(function _valid(profile): boolean { return _IsNamespace(profile.namespace) && profile.namespace !== profile.serverNamespace; }) && namespaces.size === values.length;
}
