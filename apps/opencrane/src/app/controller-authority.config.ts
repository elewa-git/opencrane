import type { ControllerAuthorityConfig } from "./controller-authority.config.types.js";

/** Loads the closed controller authority configuration, or disables the route when incomplete. */
export function _LoadControllerAuthorityConfig(environment: NodeJS.ProcessEnv = process.env): ControllerAuthorityConfig | null
{
	const controllerNamespace = environment["AGENT_CONTROLLER_NAMESPACE"]?.trim() ?? "";
	const controllerServiceAccountName = environment["AGENT_CONTROLLER_SERVICE_ACCOUNT"]?.trim() ?? "";
	const profileName = environment["AGENT_RUNTIME_PROFILE"]?.trim() ?? "";
	const runtimeNamespace = environment["AGENT_RUNTIME_NAMESPACE"]?.trim() ?? "";
	const runtimeServiceAccountName = environment["AGENT_RUNTIME_SERVICE_ACCOUNT"]?.trim() ?? "";
	const runtimeImage = environment["AGENT_RUNTIME_IMAGE"]?.trim() ?? "";
	const assignmentTtlSeconds = Number(environment["AGENT_RUNTIME_ASSIGNMENT_TTL_SECONDS"]?.trim());
	if (!_dnsLabel(controllerNamespace) || !_dnsLabel(controllerServiceAccountName) || !_dnsLabel(profileName) || !_dnsLabel(runtimeNamespace) || !_dnsLabel(runtimeServiceAccountName) || !/^.+@sha256:[a-f0-9]{64}$/u.test(runtimeImage) || !Number.isSafeInteger(assignmentTtlSeconds) || assignmentTtlSeconds < 60 || assignmentTtlSeconds > 300)
	{
		return null;
	}
	return {
		identity: { audience: "agent-controller", namespace: controllerNamespace, serviceAccountName: controllerServiceAccountName },
		runtimeProfiles: new Map([[profileName, { namespace: runtimeNamespace, serviceAccountName: runtimeServiceAccountName, image: runtimeImage, assignmentTtlMs: assignmentTtlSeconds * 1000 }]]),
	};
}

/** Returns whether a constrained configuration name is Kubernetes DNS-label safe. */
function _dnsLabel(value: string): boolean
{
	return /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/u.test(value) && value.length <= 63;
}
