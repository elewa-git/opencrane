import type { RuntimeDispatchAuthorityConfig } from "./prisma-runtime-dispatch-authority.types";

/** Validate fixed dispatch policy before any database transaction begins. */
export function _RuntimeDispatchConfigIsValid(config: RuntimeDispatchAuthorityConfig): boolean
{
	return _IsNamespace(config.personalRuntimeNamespace)
		&& _IsNamespace(config.managedRuntimeNamespace)
		&& config.personalRuntimeNamespace !== config.managedRuntimeNamespace
		&& Number.isSafeInteger(config.commandTtlMilliseconds)
		&& config.commandTtlMilliseconds >= 1_000
		&& config.commandTtlMilliseconds <= 300_000;
}

/** Return whether this namespace is one of the two configured runtime namespaces. */
export function _IsConfiguredRuntimeNamespace(namespace: string, config: RuntimeDispatchAuthorityConfig): boolean
{
	return namespace === config.personalRuntimeNamespace || namespace === config.managedRuntimeNamespace;
}

/** Return whether this value is a valid Kubernetes namespace name. */
function _IsNamespace(value: string): boolean
{
	return value.length <= 63 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value);
}
