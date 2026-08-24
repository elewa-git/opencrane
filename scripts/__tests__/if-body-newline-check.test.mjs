import assert from "node:assert/strict";
import test from "node:test";

import { addedLineNumbers, findInlineIfBodies } from "../if-body-newline-check.mjs";

test("reports a braceless body on the condition line", function _Test()
{
	assert.deepEqual(findInlineIfBodies("if (ready) continue;"), [{ line: 1, text: "continue;" }]);
});

test("reports an opening brace on the condition line", function _Test()
{
	assert.deepEqual(findInlineIfBodies("if (ready) {\n\treturn;\n}"), [{ line: 1, text: "{" }]);
});

test("accepts a braceless body on the following line", function _Test()
{
	assert.deepEqual(findInlineIfBodies("if (ready)\n\tcontinue;"), []);
});

test("uses the closing condition line for a multiline condition", function _Test()
{
	assert.deepEqual(findInlineIfBodies("if (ready\n\t&& enabled) return;"), [{ line: 2, text: "return;" }]);
});

test("checks nested else-if statements independently", function _Test()
{
	assert.deepEqual(findInlineIfBodies("if (first)\n\treturn;\nelse if (second) throw new Error();"), [{ line: 3, text: "throw new Error();" }]);
});

test("identifies only new-side lines from zero-context Git hunks", function _Test()
{
	assert.deepEqual([...addedLineNumbers("@@ -2 +2,2 @@\n-old\n+new\n+line\n@@ -8,0 +10 @@\n+last\n")], [2, 3, 10]);
});
