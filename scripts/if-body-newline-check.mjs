import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import ts from "typescript";

/** Finds `if` statements whose body starts on the same physical line as the condition. */
export function findInlineIfBodies(sourceText, fileName = "source.ts")
{
	const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const findings = [];

	/** Walks nested functions, blocks, and statements so every `if` statement is checked. */
	function _Visit(node)
	{
		if (ts.isIfStatement(node))
		{
			const conditionLine = sourceFile.getLineAndCharacterOfPosition(node.expression.end).line;
			const bodyStart = node.thenStatement.getStart(sourceFile);
			const bodyLine = sourceFile.getLineAndCharacterOfPosition(bodyStart).line;
			if (conditionLine === bodyLine)
			{
				findings.push({ line: bodyLine + 1, text: sourceFile.text.slice(bodyStart, node.thenStatement.end).split("\n", 1)[0] ?? "" });
			}
		}
		ts.forEachChild(node, _Visit);
	}

	_Visit(sourceFile);
	return findings;
}

/** Returns the new-side line numbers represented by zero-context Git diff hunks. */
function _AddedLineNumbers(diff)
{
	const lines = new Set();
	for (const match of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gmu))
	{
		const start = Number.parseInt(match[1] ?? "0", 10);
		const count = Number.parseInt(match[2] ?? "1", 10);
		for (let offset = 0; offset < count; offset += 1)
			lines.add(start + offset);
	}
	return lines;
}

/** Finds inline `if` bodies introduced after the supplied Git base. */
function _FindAddedInlineIfBodies(sourceText, fileName, base, basePath)
{
	const paths = basePath === undefined || basePath === fileName ? [fileName] : [basePath, fileName];
	const diff = execFileSync("git", ["diff", "--find-renames=50%", "--unified=0", "--no-ext-diff", base, "--", ...paths], { encoding: "utf8" });
	const added = _AddedLineNumbers(diff);
	if (diff.length === 0 && !_IsTracked(fileName))
		return findInlineIfBodies(sourceText, fileName);
	return findInlineIfBodies(sourceText, fileName).filter(function _Added(finding) { return added.has(finding.line); });
}

/** Resolves the former path of every renamed or copied TypeScript file in a Git diff. */
function _BasePaths(base)
{
	const fields = execFileSync("git", ["diff", "--find-renames=50%", "--name-status", "-z", base, "--", "*.ts"], { encoding: "utf8" }).split("\0").filter(Boolean);
	const basePaths = new Map();
	for (let index = 0; index < fields.length;)
	{
		const status = fields[index++] ?? "";
		if (!status.startsWith("R") && !status.startsWith("C"))
		{
			index += 1;
			continue;
		}
		const basePath = fields[index++] ?? "";
		const fileName = fields[index++] ?? "";
		if (fileName.length > 0 && basePath.length > 0)
			basePaths.set(fileName, basePath);
	}
	return basePaths;
}

/** Returns whether Git tracks the candidate file. */
function _IsTracked(fileName)
{
	try
	{
		execFileSync("git", ["ls-files", "--error-unmatch", "--", fileName], { stdio: "ignore" });
		return true;
	}
	catch
	{
		return false;
	}
}

/** Returns whether the comparison base already contains this rule. */
function _BaseContainsRule(base)
{
	try
	{
		execFileSync("git", ["cat-file", "-e", `${base}:scripts/if-body-newline-check.mjs`], { stdio: "ignore" });
		return true;
	}
	catch
	{
		return false;
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] !== undefined)
{
	const diffMode = process.argv[2] === "--diff";
	const base = diffMode ? process.argv[3] : undefined;
	const fileNames = process.argv.slice(diffMode ? 4 : 2);
	if (fileNames.length === 0 || (diffMode && base === undefined)) throw new Error("usage: if-body-newline-check.mjs [--diff <base>] <file> [...files]");
	// A branch that introduces the rule cannot reclassify earlier commits in the same cumulative PR.
	// The next comparison base contains the checker, so every later added line is enforced.
	if (base !== undefined && !_BaseContainsRule(base)) process.exit(0);
	const basePaths = base === undefined ? new Map() : _BasePaths(base);
	for (const fileName of fileNames)
	{
		const sourceText = readFileSync(fileName, "utf8");
		const findings = base === undefined ? findInlineIfBodies(sourceText, fileName) : _FindAddedInlineIfBodies(sourceText, fileName, base, basePaths.get(fileName));
		for (const finding of findings) process.stdout.write(`${fileName}:${finding.line}:${finding.text}\n`);
	}
}
