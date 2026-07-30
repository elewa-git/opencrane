import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
	evaluateGrowth,
	isProductionSource,
	lineCount,
	resolveExceptions,
	validateConfiguration,
} from "./core.mjs";
import {
	addedLines,
	assertBaseRef,
	baseContent,
	changedFiles,
	repositoryRoot,
} from "./git.mjs";

function _Arguments(argv)
{
	let baseRef = "HEAD";
	const explicitFiles = [];
	for (let index = 0; index < argv.length; index += 1)
	{
		if (argv[index] === "--diff")
		{
			baseRef = argv[index + 1];
			if (!baseRef)
			{
				throw new Error("--diff requires a base ref");
			}
			index += 1;
			continue;
		}
		explicitFiles.push(argv[index]);
	}
	return { baseRef, explicitFiles };
}

function _Configuration(repoRoot)
{
	const path = resolve(repoRoot, "docs/agents/module-growth-policy.json");
	const configuration = JSON.parse(readFileSync(path, "utf8"));
	validateConfiguration(configuration);
	return configuration;
}

/**
 * Run the module-growth gate for CLI arguments and set the process exit status.
 *
 * @param {string[]} argv Command-line arguments excluding Node and script paths.
 */
export function runModuleGrowthCheck(argv)
{
	const root = repositoryRoot(process.cwd());
	const { baseRef, explicitFiles } = _Arguments(argv);
	assertBaseRef(root, baseRef);
	const configuration = _Configuration(root);
	const today = new Date().toISOString().slice(0, 10);
	const exceptions = resolveExceptions(configuration.exceptions, today);
	let errorCount = 0;
	let warningCount = 0;

	for (const message of exceptions.errors)
	{
		console.error(`docs/agents/module-growth-policy.json:1\tERROR\tMODULE-GROWTH-EXCEPTION\t${message}`);
		errorCount += 1;
	}

	const files = changedFiles(root, baseRef, explicitFiles)
		.filter((file) => existsSync(resolve(root, file.path)))
		.filter((file) => isProductionSource(file.path, configuration.sourceExtensions));
	for (const file of files)
	{
		const filePath = file.path;
		const currentLines = lineCount(readFileSync(resolve(root, filePath), "utf8"));
		const previousLines = lineCount(file.basePath
			? baseContent(root, baseRef, file.basePath)
			: "");
		const additions = addedLines(root, baseRef, filePath, currentLines, file.basePath);
		const exception = exceptions.active.get(filePath);
		const findings = evaluateGrowth({
			addedLines: additions,
			baseLines: previousLines,
			currentLines,
			exempt: Boolean(exception),
			largeAdditionLines: configuration.largeAdditionLines,
			maximumLines: configuration.maximumLines,
			warningLines: configuration.warningLines,
		});
		if (exception && currentLines > configuration.maximumLines && currentLines > previousLines)
		{
			console.log(`${filePath}:1\tEXEMPT\tMODULE-GROWTH-LIMIT\t${exception.owner}; expires ${exception.expiresOn}; ${exception.reason}`);
		}
		for (const finding of findings)
		{
			console.log(`${filePath}:1\t${finding.level}\t${finding.rule}\t${finding.message}`);
			if (finding.level === "ERROR")
			{
				errorCount += 1;
			}
			else
			{
				warningCount += 1;
			}
		}
	}

	console.log(`module-growth-check: ${files.length} production source file(s) checked — ${errorCount} error(s), ${warningCount} review candidate(s).`);
	process.exitCode = errorCount > 0 ? 1 : 0;
}
