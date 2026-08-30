import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createProjectGraphAsync } from "@nx/devkit";
import {
	chartValues,
	packageVersion,
	validateHelmTransition,
	validateUmbrella,
} from "./chart-validation.mjs";
import { validateDatabase, validateDatabaseOperand } from "./database-validation.mjs";
import { createReleaseManifestValidator } from "./manifest-validation.mjs";
import { compareSemver, isAdjacentMinor, parseSemver, readJson, sha256 } from "./version-utils.mjs";

/**
 * Selects the revision that owns the candidate release's direct changes.
 *
 * CI can validate cumulatively from an older successful base, but the declared predecessor
 * keeps that base's already-released changes out of the candidate's direct diff.
 * Called by: `release-versioning-check.mjs` before it validates the workspace.
 * @param {string} base The last successful workflow revision used for cumulative validation.
 * @param {string | null} predecessorRef The immutable predecessor tag or commit when one exists.
 * @returns {string} The immutable predecessor reference, or the cumulative base for adoption.
 * @see validateWorkspace
 */
export function __SelectDirectReleaseComparisonBase(base, predecessorRef)
{
	return predecessorRef ?? base;
}

const _IGNORED_TOUCH = [
	/(?:^|\/)README\.md$/u,
	/(?:^|\/)helm\/migrations\//u,
];

/** Remove version mirrors and non-runtime root metadata before classifying an adaptation. */
export function releaseStampComparable(file, source)
{
	if (file === "package-lock.json")
	{
		const value = JSON.parse(source);
		delete value.version;
		for (const [path, packageValue] of Object.entries(value.packages ?? {}))
			if (!path.startsWith("node_modules/") && packageValue) delete packageValue.version;
		return JSON.stringify(value);
	}
	if (file === "package.json")
	{
		const value = JSON.parse(source);
		return JSON.stringify({
			dependencies: value.dependencies ?? {},
			devDependencies: value.devDependencies ?? {},
			optionalDependencies: value.optionalDependencies ?? {},
			peerDependencies: value.peerDependencies ?? {},
			overrides: value.overrides ?? {},
			engines: value.engines ?? {},
		});
	}
	if (file.endsWith("/package.json") || file.endsWith("/project.json"))
	{
		const value = JSON.parse(source);
		if (file.endsWith("/package.json")) delete value.version;
		else
		{
			if (value.metadata) delete value.metadata.release;
			if (value.metadata && Object.keys(value.metadata).length === 0) delete value.metadata;
		}
		return JSON.stringify(value);
	}
	if (file.endsWith("/helm/Chart.yaml"))
		return source.split("\n").filter((line) => !/^(?:version|appVersion):/u.test(line)).join("\n");
	return source;
}

function _ProjectMetadata(node)
{
	return node.data.metadata?.release;
}

function _ValidateTransition(manifest, errors)
{
	const previous = manifest.previousRepositoryVersion;
	if (manifest.adoptionBaseline)
	{
		if (previous !== null) errors.push("adoption baseline must not name a previous repository version");
		return;
	}
	if (!previous) errors.push("non-adoption release must name its previous repository version");
	else if (!isAdjacentMinor(previous, manifest.repositoryVersion))
	{
		if (manifest.manualTransition?.approved !== true
			|| typeof manifest.manualTransition.reason !== "string"
			|| manifest.manualTransition.reason.trim() === "")
			errors.push("patch, skipped-minor, or major transitions require an explicit approved manualTransition with a non-empty reason");
	}
}

/**
 * Selects the applications whose own files changed in this release.
 *
 * Only these applications must advance to the root version. An application that changed only
 * through a shared library, the root dependency set, or the lockfile keeps its last released
 * version: images are pinned by commit SHA at publication, so restating the root version on
 * every untouched application recorded no extra information and failed CI on every shared
 * change until each manifest entry was bumped by hand.
 */
function _DirectlyChangedApplications(graph, changedFiles, stampOnlyFiles)
{
	const projectRoots = Object.entries(graph.nodes)
		.map(([name, node]) => [name, node.data.root])
		.sort((left, right) => right[1].length - left[1].length);
	const touchedProjects = new Set();
	for (const file of changedFiles)
	{
		if (stampOnlyFiles.has(file) || _IGNORED_TOUCH.some((pattern) => pattern.test(file))) continue;
		const owner = projectRoots.find(([, root]) => file === root || file.startsWith(`${root}/`));
		if (owner) touchedProjects.add(owner[0]);
	}
	return new Set([...touchedProjects].filter((name) => graph.nodes[name]?.data.projectType === "application"));
}

function _ValidateProject(
	repositoryRoot,
	manifest,
	previousManifest,
	name,
	project,
	node,
	changedFiles,
	stampOnlyFiles,
	adaptedApplications,
	errors,
)
{
	const rootVersion = manifest.repositoryVersion;
	if (!node) return errors.push(`release manifest project '${name}' is absent from the Nx graph`);
	if (node.data.root !== project.root) errors.push(`${name} root '${node.data.root}' differs from manifest '${project.root}'`);
	if (compareSemver(project.adaptedVersion, rootVersion) > 0) errors.push(`${name} adapted version exceeds root version`);
	if (_ProjectMetadata(node)?.adaptedVersion !== project.adaptedVersion)
		errors.push(`${name} Nx metadata.release.adaptedVersion does not match the release manifest`);
	const packageVersionMirror = packageVersion(repositoryRoot, project.root);
	const expectedPackageVersion = project.packageVersion ?? project.adaptedVersion;
	if (packageVersionMirror && packageVersionMirror !== expectedPackageVersion)
		errors.push(`${name} package.json version '${packageVersionMirror}' does not match '${expectedPackageVersion}'`);
	const chart = chartValues(repositoryRoot, project);
	const directlyTouched = adaptedApplications.has(name);
	if (project.chartVersion && !chart) errors.push(`${name} records a chart version but has no helm/Chart.yaml`);
	if (chart && chart.version !== project.chartVersion) errors.push(`${name} chart version '${chart.version}' does not match '${project.chartVersion}'`);
	if (chart)
	{
		const expectedAppVersion = project.chartAppVersion ?? project.externalAppVersion ?? project.adaptedVersion;
		if (chart.appVersion !== expectedAppVersion) errors.push(`${name} chart appVersion '${chart.appVersion}' does not match '${expectedAppVersion}'`);
		if (directlyTouched && expectedAppVersion !== project.adaptedVersion && !project.externalAppVersion)
			errors.push(`${name} is directly adapted but chart appVersion remains '${expectedAppVersion}' instead of '${project.adaptedVersion}'`);
	}
	const previousProject = previousManifest?.projects?.[name];
	if (previousProject && compareSemver(project.adaptedVersion, previousProject.adaptedVersion) < 0)
		errors.push(`${name} adapted version regresses from '${previousProject.adaptedVersion}' to '${project.adaptedVersion}'`);
	if (directlyTouched && project.adaptedVersion !== rootVersion)
		errors.push(`${name} changed directly but remains at '${project.adaptedVersion}' instead of root '${rootVersion}'`);
	if (previousProject && !directlyTouched && project.adaptedVersion !== previousProject.adaptedVersion)
		errors.push(`${name} was not adapted but its version changed from '${previousProject.adaptedVersion}' to '${project.adaptedVersion}'`);
	const chartTouched = changedFiles.some((file) => file.startsWith(`${project.root}/helm/`)
		&& !stampOnlyFiles.has(file) && !_IGNORED_TOUCH.some((pattern) => pattern.test(file)));
	if (manifest.adoptionBaseline)
	{
		if (chartTouched) errors.push(`${name} chart changed after adoption; bump the root minor version and add a Helm transition`);
		return;
	}
	if (!previousProject) return;
	const previousVersion = previousProject.chartVersion;
	if (previousVersion && !project.chartVersion)
	{
		errors.push(`${name} removes chart version '${previousVersion}' without a manual transition`);
		return;
	}
	if (previousVersion && project.chartVersion && compareSemver(project.chartVersion, previousVersion) < 0)
		errors.push(`${name} chart version regresses from '${previousVersion}' to '${project.chartVersion}'`);
	if (chartTouched && previousVersion === project.chartVersion)
	{
		errors.push(`${name} chart behavior changed without advancing chart version '${project.chartVersion}'`);
		return;
	}
	if (!previousVersion || previousVersion === project.chartVersion) return;
	const migration = join(repositoryRoot, project.root, "helm", "migrations", `${previousVersion}-to-${project.chartVersion}.json`);
	if (!existsSync(migration))
	{
		errors.push(`${name} chart change requires transition '${relative(repositoryRoot, migration)}'`);
		return;
	}
	validateHelmTransition(migration, relative(repositoryRoot, migration), previousVersion, project.chartVersion, errors);
}

/**
 * Validates the candidate's release composition against the workspace and Nx graph.
 *
 * The tagged-version guard reads `suppliedDirectChangedFiles`, not `changedFiles`: the latter also
 * carries history already on the candidate's base for cumulative validation. A tagged version is
 * immutable against this candidate's changes, so inherited history must not make it fail.
 * `suppliedRestoredHistoricalManifestFiles` admits only a file that the caller proved byte-equal to
 * its own immutable tag, allowing a branch to repair later drift without authorizing new history.
 * `suppliedRemovedUntaggedHistoricalManifestFiles` admits only a deletion whose missing tag the
 * caller proved, so an abandoned candidate can be removed without weakening tagged history.
 *
 * Called by: `scripts/release-versioning-check.mjs`.
 * @returns Every release-composition error the caller must resolve before accepting the candidate.
 */
export async function validateWorkspace(
	repositoryRoot,
	changedFiles = [],
	suppliedGraph = null,
	suppliedStampOnlyFiles = [],
	suppliedNewFiles = [],
	releasedVersionTag = null,
	suppliedDirectChangedFiles = changedFiles,
	suppliedRestoredHistoricalManifestFiles = [],
	suppliedRemovedUntaggedHistoricalManifestFiles = [],
)
{
	const rootVersion = readJson(join(repositoryRoot, "package.json")).version;
	parseSemver(rootVersion);
	const manifestPath = join(repositoryRoot, "releases", `${rootVersion}.json`);
	if (!existsSync(manifestPath)) return [`missing release manifest releases/${rootVersion}.json`];
	const manifest = readJson(manifestPath);
	const errors = [];
	const validateReleaseManifest = createReleaseManifestValidator(repositoryRoot);
	errors.push(...validateReleaseManifest(manifest));
	const stampOnlyFiles = new Set(suppliedStampOnlyFiles);
	const newFiles = new Set(suppliedNewFiles);
	const directChangedFiles = new Set(suppliedDirectChangedFiles);
	const restoredHistoricalManifestFiles = new Set(suppliedRestoredHistoricalManifestFiles);
	const removedUntaggedHistoricalManifestFiles = new Set(suppliedRemovedUntaggedHistoricalManifestFiles);
	if (releasedVersionTag)
	{
		const compositionChanged = [...directChangedFiles].some((file) =>
			!_IGNORED_TOUCH.some((pattern) => pattern.test(file))
			&& (file === "package.json" || file === "package-lock.json" || file === "nx.json"
				|| file.startsWith("apps/") || file.startsWith("libs/") || file.startsWith("website/")
				|| file.startsWith("releases/")));
		if (compositionChanged)
			errors.push(`repository version '${rootVersion}' is already bound by tag '${releasedVersionTag}'; advance the repository train before changing release composition`);
	}
	for (const file of changedFiles)
	{
		const changedManifestVersion = /^releases\/(?<version>\d+\.\d+\.\d+)\.json$/u.exec(file)?.groups?.version;
		if (!changedManifestVersion || changedManifestVersion === rootVersion) continue;
		if (!directChangedFiles.has(file)) continue;
		if (!existsSync(join(repositoryRoot, file)))
		{
			if (!removedUntaggedHistoricalManifestFiles.has(file))
				errors.push(`release manifest '${changedManifestVersion}' is immutable; create '${rootVersion}' instead`);
			continue;
		}
		if (restoredHistoricalManifestFiles.has(file)) continue;
		if (!newFiles.has(file))
		{
			errors.push(`release manifest '${changedManifestVersion}' is immutable; create '${rootVersion}' instead`);
			continue;
		}
		if (changedManifestVersion !== manifest.previousRepositoryVersion)
		{
			errors.push(`new historical manifest '${changedManifestVersion}' must be the current release's exact predecessor`);
			continue;
		}
		const historicalManifest = readJson(join(repositoryRoot, file));
		if (historicalManifest.repositoryVersion !== changedManifestVersion
			|| historicalManifest.adoptionBaseline !== true || historicalManifest.previousRepositoryVersion !== null)
			errors.push(`historical manifest '${changedManifestVersion}' must be an exact adoption baseline`);
	}
	if (manifest.repositoryVersion !== rootVersion) errors.push("release manifest repositoryVersion differs from root package.json");
	_ValidateTransition(manifest, errors);
	let previousManifest = null;
	if (manifest.previousRepositoryVersion)
	{
		const previousManifestPath = join(repositoryRoot, "releases", `${manifest.previousRepositoryVersion}.json`);
		if (!existsSync(previousManifestPath)) errors.push(`previous release manifest '${manifest.previousRepositoryVersion}' is missing`);
		else previousManifest = readJson(previousManifestPath);
		if (previousManifest) errors.push(...validateReleaseManifest(previousManifest, "previous release manifest"));
	}
	const graph = suppliedGraph ?? await createProjectGraphAsync();
	const adaptedApplications = _DirectlyChangedApplications(graph, changedFiles, stampOnlyFiles);
	const applicationNames = Object.entries(graph.nodes)
		.filter(([, node]) => node.data.projectType === "application")
		.map(([name]) => name)
		.sort();
	const manifestNames = Object.keys(manifest.projects).sort();
	if (JSON.stringify(applicationNames) !== JSON.stringify(manifestNames))
		errors.push(`release manifest projects differ from Nx applications: expected ${applicationNames.join(", ")}`);
	for (const [name, project] of Object.entries(manifest.projects))
		_ValidateProject(
			repositoryRoot,
			manifest,
			previousManifest,
			name,
			project,
			graph.nodes[name],
			changedFiles,
			stampOnlyFiles,
			adaptedApplications,
			errors,
		);
	validateUmbrella(repositoryRoot, manifest, previousManifest, errors);
	validateDatabaseOperand(manifest, errors);
	validateDatabase(repositoryRoot, manifest, errors);
	return errors;
}
