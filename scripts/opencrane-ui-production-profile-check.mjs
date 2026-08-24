import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const _BUNDLE_ROOT = resolve(process.argv[2] ?? "dist/apps/opencrane-ui/browser");

/** Identifies fixture strings that must disappear when Angular keeps the live build entry points. */
const _LOCAL_MARKERS =
[
	"Local Developer",
	"q1-decision-speed",
	"Tier 1 follows one reviewed Commander/Guardian path",
	"Tier 1 local development blocked",
	"mockScenario"
];

/** Walks nested build chunks because Angular may place lazy route code below the bundle root. */
async function _JavaScriptFiles(directory)
{
	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];
	for (const entry of entries)
	{
		const path = resolve(directory, entry.name);
		if (entry.isDirectory())
		{
			files.push(...await _JavaScriptFiles(path));
		}
		else if (entry.name.endsWith(".js"))
		{
			files.push(path);
		}
	}
	return files;
}

const files = await _JavaScriptFiles(_BUNDLE_ROOT);
if (!files.length)
{
	throw new Error(`No production JavaScript bundles were found under ${_BUNDLE_ROOT}.`);
}
for (const file of files)
{
	const source = await readFile(file, "utf8");
	for (const marker of _LOCAL_MARKERS)
	{
		if (source.includes(marker))
		{
			throw new Error(`The production bundle ${file} contains the local-development marker ${marker}.`);
		}
	}
}
