import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { gunzipSync } from "node:zlib";

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

function _PackagedChartFiles(path)
{
	const archive = gunzipSync(readFileSync(path));
	const files = new Map();
	let offset = 0;
	while (offset + 512 <= archive.length)
	{
		const header = archive.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) break;
		const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/u, "");
		const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/u, "");
		const fullName = prefix ? `${prefix}/${name}` : name;
		const sizeText = header.subarray(124, 136).toString("utf8").replace(/\0.*$/u, "").trim();
		const size = Number.parseInt(sizeText || "0", 8);
		if (!Number.isFinite(size)) throw new Error(`invalid tar entry size in '${path}'`);
		const type = header.subarray(156, 157).toString("utf8");
		const relativeName = fullName.split("/").slice(1).join("/");
		if ((type === "" || type === "0") && relativeName)
			files.set(relativeName, archive.subarray(offset + 512, offset + 512 + size));
		offset += 512 + Math.ceil(size / 512) * 512;
	}
	return files;
}

function _ValidatePackagedChart(sourceRoot, packagePath, chartName, chartVersion, errors)
{
	if (!existsSync(packagePath)) return;
	const temporaryRoot = mkdtempSync(join(tmpdir(), "opencrane-chart-package-"));
	try
	{
		execFileSync("helm", ["package", sourceRoot, "--destination", temporaryRoot], { stdio: "ignore" });
		const generatedPath = join(temporaryRoot, `${chartName}-${chartVersion}.tgz`);
		if (!existsSync(generatedPath))
		{
			errors.push(`Helm packaged '${chartName}' under an unexpected name or version`);
			return;
		}
		const expected = _PackagedChartFiles(generatedPath);
		const actual = _PackagedChartFiles(packagePath);
		const expectedNames = [...expected.keys()].sort();
		const actualNames = [...actual.keys()].sort();
		if (JSON.stringify(expectedNames) !== JSON.stringify(actualNames))
		{
			errors.push(`packaged dependency ${chartName}-${chartVersion}.tgz file list differs from its chart source`);
			return;
		}
		for (const name of expectedNames)
		{
			if (!expected.get(name).equals(actual.get(name)))
			{
				errors.push(`packaged dependency ${chartName}-${chartVersion}.tgz differs from source at '${name}'`);
				return;
			}
		}
	}
	catch (error)
	{
		errors.push(`could not verify packaged dependency ${chartName}-${chartVersion}.tgz: ${error.message}`);
	}
	finally
	{
		rmSync(temporaryRoot, { recursive: true, force: true });
	}
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

/** Verify umbrella pins, packages, and platform transition against app chart sources. */
export function validateUmbrella(repositoryRoot, manifest, previousManifest, errors)
{
	const umbrellaRoot = manifest.projects["deploy-k8s"]?.root;
	if (!umbrellaRoot) return;
	const expected = new Map();
	for (const project of Object.values(manifest.projects))
	{
		if (!project.chartVersion || project.root === umbrellaRoot || project.root === "apps/postgres") continue;
		const chart = chartValues(repositoryRoot, project);
		if (chart?.name) expected.set(chart.name, { root: join(repositoryRoot, project.root, "helm"), version: project.chartVersion });
	}
	const platformChart = chartValues(repositoryRoot, { root: `${umbrellaRoot}/platform` });
	if (platformChart?.name)
	{
		if (platformChart.version !== manifest.projects["deploy-k8s"].chartVersion)
			errors.push(`k8s-platform chart version '${platformChart.version}' must track its deploy-k8s owner`);
		expected.set(platformChart.name, { root: join(repositoryRoot, umbrellaRoot, "platform"), version: platformChart.version });
		const previousVersion = previousManifest?.projects?.["deploy-k8s"]?.chartVersion;
		if (previousVersion && previousVersion !== platformChart.version)
		{
			const migration = join(repositoryRoot, umbrellaRoot, "platform/migrations", `${previousVersion}-to-${platformChart.version}.json`);
			if (!existsSync(migration)) errors.push(`k8s-platform chart change requires transition '${relative(repositoryRoot, migration)}'`);
			else validateHelmTransition(migration, relative(repositoryRoot, migration), previousVersion, platformChart.version, errors);
		}
	}
	const chartDependencies = _DependencyVersions(join(repositoryRoot, umbrellaRoot, "Chart.yaml"));
	const lockDependencies = _DependencyVersions(join(repositoryRoot, umbrellaRoot, "Chart.lock"));
	for (const [name, expectedChart] of expected)
	{
		const { root, version } = expectedChart;
		if (chartDependencies.get(name) !== version) errors.push(`umbrella dependency ${name} does not pin chart version ${version}`);
		if (lockDependencies.get(name) !== version) errors.push(`Chart.lock dependency ${name} does not pin chart version ${version}`);
		const packagePath = join(repositoryRoot, umbrellaRoot, "charts", `${name}-${version}.tgz`);
		if (!existsSync(packagePath)) errors.push(`packaged dependency ${name}-${version}.tgz is missing`);
		else _ValidatePackagedChart(root, packagePath, name, version, errors);
	}
}
