import { execFileSync } from "node:child_process";

function _RunGit(repoRoot, args)
{
	return execFileSync("git", args, {
		cwd: repoRoot,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
}

function _TryGit(repoRoot, args)
{
	try
	{
		return _RunGit(repoRoot, args);
	}
	catch
	{
		return "";
	}
}

/**
 * Resolve the active repository root.
 *
 * @param {string} workingDirectory Current working directory.
 * @returns {string} Repository root.
 */
export function repositoryRoot(workingDirectory)
{
	return _RunGit(workingDirectory, ["rev-parse", "--show-toplevel"]).trim();
}

/**
 * Fail closed before using a caller-provided comparison ref.
 *
 * @param {string} repoRoot Repository root.
 * @param {string} baseRef Selected comparison ref.
 */
export function assertBaseRef(repoRoot, baseRef)
{
	_RunGit(repoRoot, ["rev-parse", "--verify", `${baseRef}^{commit}`]);
}

/**
 * Return changed tracked and untracked files, or the caller's explicit scope.
 *
 * A tracked entry keeps its path at the comparison ref. Git reports that path
 * separately for renames, which lets the caller compare the same file before
 * and after the move instead of mistaking the rename for a brand-new module.
 *
 * @param {string} repoRoot Repository root.
 * @param {string} baseRef Selected comparison ref.
 * @param {string[]} explicitFiles Explicit file scope.
 * @returns {{ path: string, basePath: string | null }[]} Unique sorted files.
 */
export function changedFiles(repoRoot, baseRef, explicitFiles)
{
	const fields = _RunGit(repoRoot, [
		"diff",
		"--name-status",
		"--find-renames",
		"-z",
		"--diff-filter=ACMR",
		baseRef,
		"--",
	]).split("\0");
	const tracked = [];
	for (let index = 0; index < fields.length - 1;)
	{
		const status = fields[index];
		const basePath = fields[index + 1];
		const renamed = status.startsWith("R");
		const path = renamed ? fields[index + 2] : basePath;
		tracked.push({ path, basePath });
		index += renamed ? 3 : 2;
	}
	const trackedByPath = new Map(tracked.map((file) => [file.path, file]));
	if (explicitFiles.length > 0)
	{
		return [...new Set(explicitFiles)]
			.sort()
			.map((path) => trackedByPath.get(path) ?? { path, basePath: path });
	}
	const untracked = _RunGit(repoRoot, [
		"ls-files",
		"--others",
		"--exclude-standard",
	]).split("\n")
		.filter(Boolean)
		.map((path) => ({ path, basePath: null }));
	const filesByPath = new Map();
	for (const file of [...tracked, ...untracked])
	{
		filesByPath.set(file.path, file);
	}
	return [...filesByPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * Read a file as it existed at the selected base, returning empty content for new files.
 *
 * @param {string} repoRoot Repository root.
 * @param {string} baseRef Selected comparison ref.
 * @param {string} filePath Repository-relative path.
 * @returns {string} Base content or empty string.
 */
export function baseContent(repoRoot, baseRef, filePath)
{
	return _TryGit(repoRoot, ["show", `${baseRef}:${filePath}`]);
}

/**
 * Return the diff's added-line count, falling back to all current lines for untracked files.
 *
 * @param {string} repoRoot Repository root.
 * @param {string} baseRef Selected comparison ref.
 * @param {string} filePath Repository-relative path.
 * @param {number} currentLines Current logical line count.
 * @param {string | null} basePath Path at the comparison ref, when one exists.
 * @returns {number} Added lines.
 */
export function addedLines(repoRoot, baseRef, filePath, currentLines, basePath)
{
	const paths = basePath && basePath !== filePath
		? [basePath, filePath]
		: [filePath];
	const output = _TryGit(repoRoot, [
		"diff",
		"--numstat",
		"--find-renames",
		baseRef,
		"--",
		...paths,
	]);
	if (!output)
	{
		return currentLines;
	}
	const added = Number.parseInt(output.split(/\s+/u)[0], 10);
	return Number.isFinite(added) ? added : currentLines;
}
