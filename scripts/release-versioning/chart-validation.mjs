import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** Read an optional app package version mirror. */
export function packageVersion(repositoryRoot, projectRoot)
{
	const path = join(repositoryRoot, projectRoot, "package.json");
	return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")).version : null;
}

/** Read the chart name and version mirrors for one app. */
export function chartValues(repositoryRoot, project)
{
	const nestedPath = join(repositoryRoot, project.root, "helm", "Chart.yaml");
	const rootPath = join(repositoryRoot, project.root, "Chart.yaml");
	const path = existsSync(nestedPath) ? nestedPath : rootPath;
	if (!existsSync(path)) return null;
	const source = readFileSync(path, "utf8");
	return {
		path,
		name: /^name:\s*(?<value>[^\s]+)\s*$/mu.exec(source)?.groups?.value,
		version: /^version:\s*(?<value>[^\s]+)\s*$/mu.exec(source)?.groups?.value,
		appVersion: /^appVersion:\s*["']?(?<value>[^\s"']+)["']?\s*$/mu.exec(source)?.groups?.value,
	};
}

function _DependencyVersions(path)
{
	const versions = new Map();
	let dependencyName = null;
	let insideDependencies = false;
	for (const line of readFileSync(path, "utf8").split("\n"))
	{
		if (/^dependencies:\s*$/u.test(line)) insideDependencies = true;
		else if (insideDependencies && /^\S/u.test(line) && !/^- name:/u.test(line)) insideDependencies = false;
		if (!insideDependencies) continue;
		const name = /^\s*- name:\s*(?<value>\S+)\s*$/u.exec(line)?.groups?.value;
		if (name) dependencyName = name;
		const version = /^\s+version:\s*(?<value>\S+)\s*$/u.exec(line)?.groups?.value;
		if (dependencyName && version)
		{
			versions.set(dependencyName, version);
			dependencyName = null;
		}
	}
	return versions;
}

/** Validate one declared chart transition. Only executable kinds may be admitted. */
export function validateHelmTransition(path, displayPath, fromVersion, toVersion, errors)
{
	let transition;
	try
	{
		transition = JSON.parse(readFileSync(path, "utf8"));
	}
	catch (error)
	{
		errors.push(`Helm transition '${displayPath}' is not valid JSON: ${error.message}`);
		return;
	}
	if (transition.fromChartVersion !== fromVersion || transition.toChartVersion !== toVersion)
		errors.push(`Helm transition '${displayPath}' does not bind ${fromVersion} to ${toVersion}`);
	if (transition.kind === "noop") return;
	errors.push(`Helm transition '${displayPath}' must be a reviewed noop; executable value migrations require an implemented deploy consumer`);
}

/**
 * Verify the umbrella declares every chart-bearing app and the platform transition exists.
 *
 * Versions are deliberately not compared: every dependency is an in-repo file:// chart, so
 * the checked-out commit already fixes the exact sources, the umbrella declares open
 * constraints, and packaging is derived at render time. Only membership can drift — an app
 * chart that falls out of the umbrella would silently stop deploying.
 */
export function validateUmbrella(repositoryRoot, manifest, previousManifest, errors)
{
	const umbrellaRoot = manifest.projects["deploy-k8s"]?.root;
	if (!umbrellaRoot) return;
	const expected = new Set();
	for (const project of Object.values(manifest.projects))
	{
		if (!project.chartVersion || project.root === umbrellaRoot || project.root === "apps/postgres") continue;
		const chart = chartValues(repositoryRoot, project);
		if (chart?.name) expected.add(chart.name);
	}
	const platformChart = chartValues(repositoryRoot, { root: `${umbrellaRoot}/platform` });
	if (platformChart?.name)
	{
		if (platformChart.version !== manifest.projects["deploy-k8s"].chartVersion)
			errors.push(`k8s-platform chart version '${platformChart.version}' must track its deploy-k8s owner`);
		expected.add(platformChart.name);
		const previousVersion = previousManifest?.projects?.["deploy-k8s"]?.chartVersion;
		if (previousVersion && previousVersion !== platformChart.version)
		{
			const migration = join(repositoryRoot, umbrellaRoot, "platform/migrations", `${previousVersion}-to-${platformChart.version}.json`);
			if (!existsSync(migration)) errors.push(`k8s-platform chart change requires transition '${relative(repositoryRoot, migration)}'`);
			else validateHelmTransition(migration, relative(repositoryRoot, migration), previousVersion, platformChart.version, errors);
		}
	}
	const chartDependencies = _DependencyVersions(join(repositoryRoot, umbrellaRoot, "Chart.yaml"));
	for (const name of expected)
	{
		if (!chartDependencies.has(name)) errors.push(`umbrella Chart.yaml does not declare dependency ${name}`);
	}
}
