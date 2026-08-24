import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import ts from "typescript";

/** Finds `if` statements whose body starts on the same physical line as the condition. */
export function findInlineIfBodies(sourceText, fileName = "source.ts")
{
	const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const findings = [];

	/** Visits every statement because an `if` can appear inside any expression or block. */
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

/** Moves every same-line `if` body to the following line without changing the statement itself. */
export function formatIfBodyNewlines(sourceText, fileName = "source.ts")
{
	const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const edits = [];

	/** Collects edits before applying them from the end of the file to the beginning. */
	function _Visit(node)
	{
		if (ts.isIfStatement(node))
		{
			const bodyStart = node.thenStatement.getStart(sourceFile);
			const conditionLine = sourceFile.getLineAndCharacterOfPosition(node.expression.end).line;
			const bodyLine = sourceFile.getLineAndCharacterOfPosition(bodyStart).line;
			if (conditionLine === bodyLine)
			{
				const closeParenthesis = sourceText.indexOf(")", node.expression.end);
				const statementStart = node.getStart(sourceFile);
				const lineStart = sourceText.lastIndexOf("\n", statementStart - 1) + 1;
				const indentation = sourceText.slice(lineStart, statementStart);
				const bodyIndentation = ts.isBlock(node.thenStatement) ? indentation : `${indentation}\t`;
				edits.push({ start: closeParenthesis + 1, end: bodyStart, replacement: `\n${bodyIndentation}` });
			}
		}
		ts.forEachChild(node, _Visit);
	}

	_Visit(sourceFile);
	return edits.sort(function _LastFirst(left, right) { return right.start - left.start; })
		.reduce(function _Apply(content, edit) { return `${content.slice(0, edit.start)}${edit.replacement}${content.slice(edit.end)}`; }, sourceText);
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] !== undefined)
{
	const write = process.argv[2] === "--write";
	const fileNames = process.argv.slice(write ? 3 : 2);
	for (const fileName of fileNames)
	{
		const sourceText = readFileSync(fileName, "utf8");
		if (write)
		{
			writeFileSync(fileName, formatIfBodyNewlines(sourceText, fileName));
			continue;
		}
		for (const finding of findInlineIfBodies(sourceText, fileName)) process.stdout.write(`${finding.line}:${finding.text}\n`);
	}
}
