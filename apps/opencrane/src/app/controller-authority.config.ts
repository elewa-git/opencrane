import type { ControllerAuthorityConfig } from "./controller-authority.config.types.js";

/**
 * Loads the closed controller authority configuration, or disables the route when incomplete.
 *
 * Required — every value must be present and valid or the loader returns `null`:
 * - `AGENT_CONTROLLER_NAMESPACE` / `AGENT_CONTROLLER_SERVICE_ACCOUNT` — the exact TokenReview
 *   identity of the sole permitted caller, `apps/agent-controller`; DNS labels.
 * - `AGENT_RUNTIME_PROFILE` / `AGENT_RUNTIME_NAMESPACE` / `AGENT_RUNTIME_SERVICE_ACCOUNT` — the
 *   runtime profile name and the zero-RBAC identity its Jobs run under; DNS labels.
 * - `AGENT_RUNTIME_IMAGE` — digest-pinned (`…@sha256:<64 hex>`); a floating tag never validates.
 * - `AGENT_RUNTIME_ASSIGNMENT_TTL_SECONDS` — a safe integer between 60 and 300.
 *
 * Fail-closed contract: `null` means the controller authority route is never mounted, so the
 * controller cannot claim, acknowledge, or reject any work — the run plane simply does not exist
 * in this process. There are deliberately no defaults: a guessed controller identity would make
 * TokenReview authenticate the wrong workload, and an unpinned image would let the controller
 * schedule unreviewed code. A visibly absent route is diagnosable; a route mounted with invented
 * authority is not.
 */
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
