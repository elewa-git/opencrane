import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** Return physical source lines containing more than one ternary conditional. */
export function inlineConditionalDensity(sourcePath, source)
{
	const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const counts = new Map();

	/** Count each ternary by the physical line containing its question token. */
	function _Visit(node)
	{
		if (ts.isConditionalExpression(node))
		{
			const line = sourceFile.getLineAndCharacterOfPosition(node.questionToken.getStart(sourceFile)).line + 1;
			counts.set(line, (counts.get(line) ?? 0) + 1);
		}
		ts.forEachChild(node, _Visit);
	}

	_Visit(sourceFile);
	return [...counts.entries()].filter(function _Repeated(entry) { return entry[1] > 1; }).map(function _Line(entry) { return entry[0]; }).sort(function _Ascending(left, right) { return left - right; });
}

/** Print checker-compatible line coordinates when invoked as a command. */
function _Main(sourcePath)
{
	const source = readFileSync(sourcePath, "utf8");
	for (const line of inlineConditionalDensity(sourcePath, source))
	{
		process.stdout.write(`${line}:inline conditional density\n`);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] !== undefined)
{
	_Main(process.argv[2]);
}
