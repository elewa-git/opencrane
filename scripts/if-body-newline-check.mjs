import { readFileSync } from "node:fs";
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

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] !== undefined)
{
	const fileName = process.argv[2];
	for (const finding of findInlineIfBodies(readFileSync(fileName, "utf8"), fileName)) process.stdout.write(`${finding.line}:${finding.text}\n`);
}
