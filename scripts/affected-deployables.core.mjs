/**
 * Returns the publish descriptor owned by one container target.
 *
 * A project is publishable only when its app-owned target declares both the image repository suffix
 * and Dockerfile. This keeps the workflow selector independent from an incomplete root registry.
 */
function _ReleaseDescriptor(project)
{
	const release = project.targets?.container?.metadata?.release;
	if (typeof project.name !== "string" || project.name.length === 0 || typeof release?.image !== "string" || release.image.length === 0 || typeof release.dockerfile !== "string" || release.dockerfile.length === 0)
	{
		throw new Error(`Affected container project '${project.name ?? "<unnamed>"}' must declare targets.container.metadata.release.image and dockerfile.`);
	}

	return {
		project: project.name,
		image: release.image,
		dockerfile: release.dockerfile,
	};
}

/**
 * Resolves the intentionally narrow manual publication set.
 *
 * `null` delegates to the normal affected-project calculation (push and pull-request validation),
 * while `none` produces no matrix entry so workflow dispatch is validation-only by default.
 */
export function selectForcedContainerProjects(force)
{
	if (!force) return null;
	if (force === "none") return [];
	if (force === "bootstrap") return ["channel-proxy", "memory-gateway"];
	if (force === "artifact") return ["artifact-service"];
	if (force === "server") return ["opencrane"];
	if (force === "ui") return ["opencrane-ui"];
	throw new Error(`unsupported FORCE_DEPLOYABLES value: ${force}`);
}

/** Selects deterministic publish entries from affected app-owned container targets. */
export function selectAffectedDeployables(containerProjects)
{
	return [...containerProjects]
		.sort(function _ByName(left, right) { return left.name.localeCompare(right.name); })
		.map(function _Descriptor(project) { return _ReleaseDescriptor(project); });
}

/** Determines whether an affected project can change the generated API contract. */
export function selectApiContractChanged(affectedProjects)
{
	return affectedProjects.includes("opencrane") || affectedProjects.includes("contracts");
}

/** Determines whether changed files require the topology negative-test fixtures to run. */
export function selectGuardInputsChanged(changedFiles)
{
	return changedFiles.some(function _GuardInput(file) {
		return file.startsWith("scripts/workload-ownership-app-composition-boundary")
			|| file === "docs/agents/workload-ownership.json"
			|| file === "docs/agents/app-source-allowlist.json"
			|| file.includes("/helm/")
			|| file === ".github/workflows/docker.yml";
	});
}

/** Determines whether a pull request changed the live deployment surface exercised by k3d. */
export function selectDevelopSmokeRequired(changedFiles)
{
	return changedFiles.some(function _DevelopSmokeInput(file) {
		return file.startsWith("apps/_infra/deploy-k8s/")
			|| (file.startsWith("apps/") && (file.includes("/helm/") || file.includes("/deploy/")))
			|| file === ".github/workflows/docker.yml";
	});
}
