#!/usr/bin/env node

/**
 * Strips the `.js` extension from relative import specifiers in first-party TypeScript.
 *
 * The repo type-checks with `moduleResolution: "bundler"` and ships every runtime artifact as an
 * esbuild bundle, so a relative import does not need to name the compiled file. Writing `./foo`
 * instead of `./foo.js` keeps the specifier pointing at the file that actually exists on disk.
 *
 * Re-runnable and idempotent. Run it again after rebasing a branch that predates the switch
 * instead of resolving the import lines by hand.
 *
 * Usage:
 *   node scripts/relative-import-extensions.mjs             # rewrite apps/ and libs/
 *   node scripts/relative-import-extensions.mjs --check     # report only; exit 1 if work remains
 *   node scripts/relative-import-extensions.mjs libs/util   # limit to given paths
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Directories that never hold first-party source. */
const _SKIP_DIRECTORIES = new Set([".angular", ".git", ".nx", "coverage", "dist", "node_modules", "out-tsc"]);

/** File suffixes the rewrite applies to. */
const _SOURCE_SUFFIXES = [".ts", ".tsx", ".mts", ".cts"];

/** Roots scanned when the caller names no paths. */
const _DEFAULT_ROOTS = ["apps", "libs"];

/**
 * Matches a relative specifier ending in `.js`, in every position that names a module.
 *
 * Group 1 is the leading keyword or call plus its opening quote, group 2 the path without the
 * extension, group 3 the closing quote. `.mjs` and `.cjs` do not match because the character
 * before `js` must be a dot, and `.json` does not match because `js` must end the path.
 */
const _SPECIFIER = /(\bfrom\s*["']|\bimport\s*["']|\bimport\s*\(\s*["']|\brequire\s*\(\s*["']|\bvi\.(?:mock|doMock)\s*\(\s*["'])(\.\.?\/[^"']*?)\.js(["'])/g;

/** Collects every source file under one path, following directories but skipping build output. */
function _SourceFiles(path, collected)
{
	const stats = statSync(path);
	if (stats.isFile())
	{
		if (_SOURCE_SUFFIXES.some(function _Matches(suffix) { return path.endsWith(suffix); })) collected.push(path);
		return collected;
	}
	if (!stats.isDirectory()) return collected;
	for (const entry of readdirSync(path, { withFileTypes: true }))
	{
		if (entry.isDirectory() && _SKIP_DIRECTORIES.has(entry.name)) continue;
		_SourceFiles(join(path, entry.name), collected);
	}
	return collected;
}

/** Rewrites one file's specifiers, returning how many changed. */
function _Rewrite(file, write)
{
	const original = readFileSync(file, "utf8");
	let changed = 0;
	const updated = original.replace(_SPECIFIER, function _Strip(_match, prefix, path, quote)
	{
		changed += 1;
		return `${prefix}${path}${quote}`;
	});
	if (changed > 0 && write) writeFileSync(file, updated);
	return changed;
}

/**
 * Rewrites (or checks) every relative import specifier under the given paths.
 *
 * @param argv - CLI arguments; `--check` reports without writing.
 */
function _Run(argv)
{
	const check = argv.includes("--check");
	const roots = argv.filter(function _IsPath(argument) { return argument !== "--check"; });
	const targets = roots.length > 0 ? roots : _DEFAULT_ROOTS;

	// 1. Gather the files first so the summary can name how much was inspected, not just changed.
	const files = [];
	for (const target of targets) _SourceFiles(resolve(process.cwd(), target), files);

	// 2. Rewrite each file, counting specifiers so a no-op run is obvious in the output.
	let touchedFiles = 0;
	let touchedSpecifiers = 0;
	for (const file of files)
	{
		const changed = _Rewrite(file, !check);
		if (changed === 0) continue;
		touchedFiles += 1;
		touchedSpecifiers += changed;
	}

	// 3. In check mode a remaining specifier is a failure, so CI can gate on the convention.
	const verb = check ? "would rewrite" : "rewrote";
	console.log(`relative-import-extensions: ${files.length} file(s) scanned — ${verb} ${touchedSpecifiers} specifier(s) in ${touchedFiles} file(s).`);
	if (check && touchedSpecifiers > 0) process.exitCode = 1;
}

_Run(process.argv.slice(2));
