#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { __SelectDirectReleaseComparisonBase, releaseStampComparable, validateWorkspace } from "./release-versioning/core.mjs";

const _GIT_TEXT_MAX_BUFFER = 16 * 1024 * 1024;

function _Argument(name)
{
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : null;
}

function _GitFiles(args)
{
	try
	{
		return execFileSync("git", args, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
	}
	catch (error)
	{
		throw new Error(`git ${args.join(" ")} failed: ${error.message}`);
	}
}

function _ChangedFiles(bases)
{
	const files = new Set([
		..._GitFiles(["diff", "--name-only"]),
		..._GitFiles(["diff", "--cached", "--name-only"]),
		..._GitFiles(["ls-files", "--others", "--exclude-standard"]),
	]);
	for (const base of bases)
		for (const file of _GitFiles(["diff", "--name-only", `${base}...HEAD`])) files.add(file);
	return [...files];
}

function _BaseText(base, file)
{
	try
	{
		return execFileSync("git", ["show", `${base}:${file}`], {
			encoding: "utf8",
			maxBuffer: _GIT_TEXT_MAX_BUFFER,
			stdio: ["ignore", "pipe", "ignore"],
		});
	}
	catch
	{
		return null;
	}
}

function _ExistingReleaseTag(version)
{
	for (const tag of [version, `v${version}`])
	{
		try
		{
			execFileSync("git", ["show-ref", "--verify", "--quiet", `refs/tags/${tag}`]);
			return tag;
		}
		catch
		{
			// Try the other repository tag convention.
		}
	}
	return null;
}

function _Commit(ref)
{
	return _GitFiles(["rev-parse", "--verify", `${ref}^{commit}`])[0];
}

function _StampOnlyFiles(repositoryRoot, base, changedFiles)
{
	const files = [];
	for (const file of changedFiles)
	{
		const currentPath = join(repositoryRoot, file);
		if (!existsSync(currentPath)) continue;
		const previous = _BaseText(base, file);
		if (previous === null) continue;
		const current = readFileSync(currentPath, "utf8");
			if (releaseStampComparable(file, previous) === releaseStampComparable(file, current)) files.push(file);
	}
	return files;
}

/** Select historical manifests whose current bytes exactly match their immutable release tag. */
function _RestoredHistoricalManifestFiles(repositoryRoot, rootVersion, changedFiles)
{
	const restored = [];
	for (const file of changedFiles)
	{
		const version = /^releases\/(?<version>\d+\.\d+\.\d+)\.json$/u.exec(file)?.groups?.version;
		if (!version || version === rootVersion) continue;
		const tag = _ExistingReleaseTag(version);
		if (!tag) continue;
		const tagged = _BaseText(tag, file);
		if (tagged !== null && readFileSync(join(repositoryRoot, file), "utf8") === tagged) restored.push(file);
	}
	return restored;
}

const repositoryRoot = resolve(new URL(".", import.meta.url).pathname, "..");
const base = _Argument("--base");
if (!base) throw new Error("--base requires an exact Git commit or ref");
_GitFiles(["rev-parse", "--verify", `${base}^{commit}`]);
const rootVersion = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8")).version;
const releaseManifest = JSON.parse(readFileSync(join(repositoryRoot, "releases", `${rootVersion}.json`), "utf8"));
const versionBase = releaseManifest.previousRepositoryVersion;
const previousRepositoryCommit = releaseManifest.previousRepositoryCommit ?? null;
const previousReleaseTag = versionBase ? _ExistingReleaseTag(versionBase) : null;
const previousReleaseCommit = previousReleaseTag ? _Commit(previousReleaseTag) : null;
const requiresPublishedPredecessor = process.argv.includes("--require-published-predecessor");
if (requiresPublishedPredecessor && versionBase && !previousReleaseTag)
{
	throw new Error(`release qualification requires an immutable Git tag for predecessor '${versionBase}'`);
}
if (previousRepositoryCommit)
{
	_Commit(previousRepositoryCommit);
	_GitFiles(["merge-base", "--is-ancestor", previousRepositoryCommit, "HEAD"]);
	if (versionBase)
	{
		const predecessorManifestText = _BaseText(previousRepositoryCommit, `releases/${versionBase}.json`);
		if (predecessorManifestText === null)
		{
			throw new Error(`previousRepositoryCommit '${previousRepositoryCommit}' does not contain releases/${versionBase}.json`);
		}
		const predecessorManifest = JSON.parse(predecessorManifestText);
		if (predecessorManifest.repositoryVersion !== versionBase)
		{
			throw new Error(`previousRepositoryCommit '${previousRepositoryCommit}' does not declare repository version '${versionBase}'`);
		}
	}
}
if (previousReleaseCommit && previousRepositoryCommit && previousReleaseCommit !== previousRepositoryCommit)
{
	throw new Error(`predecessor tag '${previousReleaseTag}' does not match previousRepositoryCommit '${previousRepositoryCommit}'`);
}
if (versionBase && !previousReleaseTag && !previousRepositoryCommit)
{
	throw new Error(`unreleased predecessor '${versionBase}' requires previousRepositoryCommit for PR validation`);
}
const releaseTag = _ExistingReleaseTag(rootVersion);
const currentCommit = _Commit("HEAD");
const releasedVersionTag = releaseTag && _Commit(releaseTag) !== currentCommit ? releaseTag : null;
const comparisonBase = __SelectDirectReleaseComparisonBase(base, previousReleaseTag ?? previousRepositoryCommit);
const directChangedFiles = _ChangedFiles([comparisonBase]);
const changedFiles = _ChangedFiles([...new Set([base, previousReleaseTag, previousRepositoryCommit, releaseTag].filter(Boolean))]);
const newFiles = changedFiles.filter((file) => _BaseText(base, file) === null);
const errors = await validateWorkspace(
	repositoryRoot,
	changedFiles,
	null,
	_StampOnlyFiles(repositoryRoot, comparisonBase, changedFiles),
	newFiles,
	releasedVersionTag,
	directChangedFiles,
	_RestoredHistoricalManifestFiles(repositoryRoot, rootVersion, directChangedFiles),
);
if (errors.length > 0)
{
	for (const error of errors) console.error(`release-versioning: ${error}`);
	process.exitCode = 1;
}
else console.log("release-versioning: PASS");
