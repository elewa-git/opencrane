const DEVELOP_SMOKE_IMAGES = [
	"artifact-service",
	"channel-proxy",
	"memory-gateway",
	"opencrane",
	"opencrane-ui",
];

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

/**
 * Returns the complete image set required by the current-silo smoke.
 *
 * Release repositories and Dockerfiles remain app-owned target metadata. The local aliases are
 * smoke-only names consumed by the disposable values profile.
 *
 * @param {object[]} containerProjects Every project that owns a container target.
 * @returns {{ project: string, image: string, dockerfile: string }[]} Complete deterministic image set.
 * @throws {Error} When a required current-silo owner or its release metadata is absent.
 */
export function selectDevelopSmokeImages(containerProjects)
{
	const projectsByName = new Map(containerProjects.map(function _ByName(project) { return [project.name, project]; }));
	return DEVELOP_SMOKE_IMAGES.map(function _SmokeImage(projectName) {
		const project = projectsByName.get(projectName);
		if (!project)
		{
			throw new Error(`current-silo smoke project '${projectName}' must own a container target`);
		}
		return _ReleaseDescriptor(project);
	});
}

/** Selects current-silo image owners whose transitive production inputs changed. */
export function selectDevelopSmokeProjects(affectedContainerProjects)
{
	const smokeProjects = new Set(DEVELOP_SMOKE_IMAGES);
	return [...new Set(affectedContainerProjects)]
		.filter(function _CurrentSilo(project) { return smokeProjects.has(project); })
		.sort(function _ByName(left, right) { return left.localeCompare(right); });
}

/**
 * Determines whether every changed path is outside the current-silo deployment contract.
 *
 * This is deliberately a positive safe-path proof. An unclassified path forces k3d so a new
 * deployment input cannot silently bypass the disposable-cluster qualification.
 */
export function selectDevelopSmokeInputsChanged(changedFiles)
{
	return changedFiles.some(function _RequiresCurrentSiloProof(file) {
		return !(file.startsWith("website/")
			|| file.startsWith("docs/")
			|| file.startsWith(".agents/")
			|| file.startsWith(".claude/")
			|| file.startsWith(".codex/")
			|| file.startsWith(".github/ISSUE_TEMPLATE/")
			|| ["README.md", "CHANGELOG.md", "plan.md", "plan-done.md"].includes(file));
	});
}

/**
 * Selects deterministic image-smoke matrix entries for `scripts/affected-deployables.mjs`.
 *
 * Automatic qualification keeps only affected owners. Manual `image-smoke` and `all`
 * qualification expand the matrix to every project that owns the target; `k3d` does not.
 *
 * @param {string[]} affectedProjects Image-smoke owners selected by the affected-project range.
 * @param {string[]} allProjects Every project that owns an image-smoke target.
 * @param {string | undefined} heavyQualification Explicit manual heavyweight selector.
 * @returns {{ project: string }[]} Sorted, de-duplicated GitHub Actions matrix entries.
 * @throws {Error} When the manual heavyweight selector is not supported.
 */
export function selectImageSmokeProjects(affectedProjects, allProjects, heavyQualification)
{
	if (heavyQualification && !["none", "image-smoke", "k3d", "all"].includes(heavyQualification))
	{
		throw new Error(`unsupported FORCE_HEAVY_QUALIFICATION value: ${heavyQualification}`);
	}

	const selected = heavyQualification === "image-smoke" || heavyQualification === "all"
		? allProjects
		: affectedProjects;
	return [...new Set(selected)]
		.sort(function _ByName(left, right) { return left.localeCompare(right); })
		.map(function _MatrixEntry(project) { return { project }; });
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

/**
 * Selects fast storage for ordinary PRs and the expansion proof for storage-sensitive changes.
 *
 * Protected develop pushes and explicit manual k3d qualification always retain the full clean
 * storage proof. A pull request pays for it only when it can change that proof or the production
 * storage/deployment owner.
 */
export function selectDevelopSmokeStorageMode(changedFiles, eventName, ref, heavyQualification)
{
	if ((eventName === "push" && ref === "refs/heads/develop")
		|| (eventName === "workflow_dispatch" && ["k3d", "all"].includes(heavyQualification)))
	{
		return "full";
	}

	const fullStorageRequired = changedFiles.some(function _StorageProofInput(file) {
		return file === ".github/workflows/docker.yml"
			|| file.startsWith("apps/postgres/")
			|| file === "apps/_infra/deploy-k8s/deploy.sh"
			|| file === "apps/_infra/deploy-k8s/platform/k8s-deploy.sh"
			|| file.startsWith("apps/_infra/deploy-k8s/platform/tests/develop-smoke");
	});
	return fullStorageRequired ? "full" : "fast";
}
