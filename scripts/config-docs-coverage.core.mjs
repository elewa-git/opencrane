import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Extracts the top-level YAML keys that the umbrella chart accepts. */
function _TopLevelKeys(valuesPath)
{
	return [...readFileSync(valuesPath, "utf8").matchAll(/^([A-Za-z0-9][A-Za-z0-9_-]*):/gmu)].map(function _Key(match) { return match[1]; });
}

/** Returns structured configuration classifications for one chart. */
function _Entries(chart)
{
	const classifications = [
		["operatorInputs", "operator input"],
		["forwardedKeys", "forwarded key"],
		["internalKeys", "internal key"],
	];
	const entries = [];

	for (const [field, kind] of classifications)
	{
		if (!Array.isArray(chart[field]))
		{
			throw new Error(`Chart '${chart.path}' must declare a ${field} array.`);
		}
		for (const entry of chart[field])
		{
			if (typeof entry?.path !== "string" || entry.path.length === 0)
			{
				throw new Error(`Chart '${chart.path}' has a ${kind} without a path.`);
			}
			if (kind === "forwarded key" && (typeof entry.owner !== "string" || entry.owner.length === 0))
			{
				throw new Error(`Chart '${chart.path}' forwarded key '${entry.path}' must name its owning chart.`);
			}
			if (kind === "internal key" && (typeof entry.reason !== "string" || entry.reason.length === 0))
			{
				throw new Error(`Chart '${chart.path}' internal key '${entry.path}' must explain why it is not an operator input.`);
			}
			entries.push({ ...entry, kind });
		}
	}

	return entries;
}

/** Inspects every chart in one explicit documentation contract. */
export function inspectConfigDocsCoverage(contract, repositoryRoot)
{
	if (contract?.version !== 1 || !Array.isArray(contract.charts))
	{
		throw new Error("Configuration documentation contract must declare version 1 and a charts array.");
	}

	const errors = [];
	const missingDocumentation = [];
	const charts = [];
	for (const chart of contract.charts)
	{
		if (typeof chart?.path !== "string" || chart.path.length === 0)
		{
			throw new Error("Configuration documentation contract has a chart without a path.");
		}
		const entries = _Entries(chart);
		const valuesPath = resolve(repositoryRoot, chart.path, "values.yaml");
		if (!existsSync(valuesPath))
		{
			errors.push(`${chart.path}: values.yaml does not exist.`);
			continue;
		}

		const declared = new Map();
		for (const entry of entries)
		{
			if (declared.has(entry.path))
			{
				errors.push(`${chart.path}: '${entry.path}' is classified more than once.`);
			}
			declared.set(entry.path, entry);
		}

		const actualKeys = _TopLevelKeys(valuesPath);
		for (const key of actualKeys)
		{
			if (!declared.has(key))
			{
				errors.push(`${chart.path}: '${key}' is not classified as an operator input, forwarded key, or internal key.`);
			}
		}
		for (const entry of entries)
		{
			if (!actualKeys.includes(entry.path))
			{
				errors.push(`${chart.path}: '${entry.path}' is classified but absent from values.yaml.`);
				continue;
			}
			if (entry.kind === "forwarded key" && !existsSync(resolve(repositoryRoot, entry.owner)))
			{
				errors.push(`${chart.path}: forwarded key '${entry.path}' names missing owner '${entry.owner}'.`);
				continue;
			}
			if (entry.kind !== "operator input")
			{
				continue;
			}
			if (typeof entry.documentation !== "string" || entry.documentation.length === 0)
			{
				errors.push(`${chart.path}: operator input '${entry.path}' has no documentation path.`);
				continue;
			}

			const documentationPath = resolve(repositoryRoot, entry.documentation);
			if (!existsSync(documentationPath) || !readFileSync(documentationPath, "utf8").includes(`\`${entry.path}\``))
			{
				missingDocumentation.push(`${chart.path}: ${entry.path} -> ${entry.documentation}`);
			}
		}
		charts.push({ path: chart.path, entries });
	}

	return { charts, errors, missingDocumentation };
}
