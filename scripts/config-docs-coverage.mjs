#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inspectConfigDocsCoverage } from "./config-docs-coverage.core.mjs";

/** Reads one JSON configuration contract. */
function _Json(path)
{
	return JSON.parse(readFileSync(path, "utf8"));
}

/** Parses the supported command-line arguments. */
function _Arguments(argumentsList)
{
	const options = { contractPath: "scripts/config-docs-contract.json", strict: false };
	for (let index = 0; index < argumentsList.length; index += 1)
	{
		const argument = argumentsList[index];
		if (argument === "--contract")
		{
			options.contractPath = argumentsList[index + 1] ?? "";
			index += 1;
		}
		else if (argument === "--strict")
		{
			options.strict = true;
		}
		else if (argument === "--help")
		{
			process.stdout.write("Usage: scripts/config-docs-coverage.sh [--contract PATH] [--strict]\n");
			process.exit(0);
		}
		else
		{
			throw new Error(`Unknown flag: ${argument}`);
		}
	}
	return options;
}

/** Runs the contract checker and prints a deploy-loop work order. */
function _Main()
{
	const repositoryRoot = process.cwd();
	const options = _Arguments(process.argv.slice(2));
	const contractPath = resolve(repositoryRoot, options.contractPath);
	const coverage = inspectConfigDocsCoverage(_Json(contractPath), repositoryRoot);
	for (const error of coverage.errors)
	{
		process.stdout.write(`CONTRACT ERROR  ${error}\n`);
	}
	for (const missing of coverage.missingDocumentation)
	{
		process.stdout.write(`UNDOCUMENTED  ${missing}\n`);
	}
	process.stdout.write(`config-docs-coverage: ${coverage.missingDocumentation.length} undocumented operator input(s); ${coverage.errors.length} contract error(s).\n`);
	if (coverage.errors.length > 0 || (options.strict && coverage.missingDocumentation.length > 0))
	{
		process.exitCode = 1;
	}
}

_Main();
