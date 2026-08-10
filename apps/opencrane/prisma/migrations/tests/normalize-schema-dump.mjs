import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function _CompareEntries(left, right)
{
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

function _SplitTableEntries(body)
{
	const entries = [];
	let current = "";
	let depth = 0;
	let quote = null;

	for (let index = 0; index < body.length; index += 1)
	{
		const character = body[index];
		const next = body[index + 1];
		current += character;

		if (quote === "single" || quote === "escape-single")
		{
			if (quote === "escape-single" && character === "\\" && next !== undefined)
			{
				current += next;
				index += 1;
			}
			else if (character === "'" && next === "'")
			{
				current += next;
				index += 1;
			}
			else if (character === "'") quote = null;
			continue;
		}
		if (quote?.startsWith("$") === true)
		{
			if (body.startsWith(quote, index))
			{
				current += quote.slice(1);
				index += quote.length - 1;
				quote = null;
			}
			continue;
		}
		if (quote === "double")
		{
			if (character === '"' && next === '"')
			{
				current += next;
				index += 1;
			}
			else if (character === '"') quote = null;
			continue;
		}
		if (character === "'")
		{
			const prefix = body[index - 1];
			const beforePrefix = body[index - 2];
			const escapePrefix = (prefix === "E" || prefix === "e")
				&& (beforePrefix === undefined || !/[A-Za-z0-9_$]/u.test(beforePrefix));
			quote = escapePrefix ? "escape-single" : "single";
			continue;
		}
		if (character === '"')
		{
			quote = "double";
			continue;
		}
		if (character === "$")
		{
			const dollarQuote = body.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u)?.[0];
			if (dollarQuote)
			{
				current += dollarQuote.slice(1);
				index += dollarQuote.length - 1;
				quote = dollarQuote;
				continue;
			}
		}
		if (character === "(") depth += 1;
		else if (character === ")") depth -= 1;
		else if (character === "," && depth === 0)
		{
			entries.push(current.slice(0, -1).trim());
			current = "";
		}
	}

	if (quote !== null || depth !== 0) throw new Error("unbalanced CREATE TABLE definition in schema dump");
	if (current.trim()) entries.push(current.trim());
	return entries;
}

/** Sort CREATE TABLE clauses so semantically irrelevant PostgreSQL column order does not hide real drift. */
export function normalizeSchemaDump(dump)
{
	const lines = dump.split("\n");
	const normalized = [];

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1)
	{
		const line = lines[lineIndex];
		if (!/^CREATE TABLE .+ \($/u.test(line))
		{
			normalized.push(line);
			continue;
		}

		const body = [];
		normalized.push(line);
		lineIndex += 1;
		while (lineIndex < lines.length && lines[lineIndex] !== ");")
		{
			body.push(lines[lineIndex]);
			lineIndex += 1;
		}
		if (lineIndex >= lines.length) throw new Error(`unterminated CREATE TABLE block: ${line}`);

		const entries = _SplitTableEntries(body.join("\n")).sort(_CompareEntries);
		for (const [entryIndex, entry] of entries.entries())
		{
			const suffix = entryIndex === entries.length - 1 ? "" : ",";
			normalized.push(`    ${entry}${suffix}`);
		}
		normalized.push(");");
	}

	return normalized.join("\n");
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === modulePath)
{
	process.stdout.write(normalizeSchemaDump(readFileSync(0, "utf8")));
}
