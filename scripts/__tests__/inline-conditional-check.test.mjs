import assert from "node:assert/strict";
import test from "node:test";

import { inlineConditionalDensity } from "../inline-conditional-check.mjs";

test("allows one ternary conditional on a physical source line", function _AllowsOneConditional()
{
	assert.deepEqual(inlineConditionalDensity("one.ts", "const value = ready ? accepted : denied;\n"), []);
});

test("rejects nested ternary conditionals on one physical source line", function _RejectsNestedConditionals()
{
	const source = "const value = ready ? accepted : missing ? fallback : denied;\n";
	assert.deepEqual(inlineConditionalDensity("nested.ts", source), [1]);
});

test("allows nested ternary conditionals when each decision occupies its own line", function _AllowsSeparateLines()
{
	const source = "const value = ready\n\t? accepted\n\t: missing\n\t\t? fallback\n\t\t: denied;\n";
	assert.deepEqual(inlineConditionalDensity("multiline.ts", source), []);
});

test("ignores optional chaining, nullish coalescing, strings, and comments", function _IgnoresQuestionMarkSyntax()
{
	const source = "const value = object?.field ?? \"why? really?\"; // ? ?\n";
	assert.deepEqual(inlineConditionalDensity("questions.ts", source), []);
});
