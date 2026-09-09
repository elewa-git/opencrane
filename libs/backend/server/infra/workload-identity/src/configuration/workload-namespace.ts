

/** Return whether one value is a bounded Kubernetes namespace DNS label. */
export function _IsNamespace(value: string): boolean
{
	return value.length <= 63 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value);
}

/**
 * Check one worker namespace at startup: it must be present, a valid DNS label, and
 * different from the server's own namespace, so a worker's token can never be mistaken for
 * the server's.
 *
 * Called by: apps/opencrane/src/bootstrap/process/runtime-composition.ts, for the artifact
 * preprocessor namespace.
 *
 * @param namespace       - Namespace from deployment configuration; may be undefined.
 * @param serverNamespace - The already validated server namespace.
 * @returns The namespace, confirmed usable.
 * @throws When it is missing, malformed, or equal to the server namespace.
 */
export function _ValidateIsolatedWorkloadNamespace(namespace: string | undefined, serverNamespace: string): string
{
	if (!namespace || !_IsNamespace(namespace) || namespace === serverNamespace)
		throw new Error("restricted workload namespace must be valid and different from POD_NAMESPACE");
	return namespace;
}
