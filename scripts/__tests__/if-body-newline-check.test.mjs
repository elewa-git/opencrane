import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { findInlineIfBodies } from "../if-body-newline-check.mjs";

/** Checker entrypoint used by the temporary Git repository regression test. */
const _CHECKER = fileURLToPath(new URL("../if-body-newline-check.mjs", import.meta.url));

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

test("enforces active-base additions without reclassifying introductions or renames", function _Test(context)
{
	const repository = mkdtempSync(join(tmpdir(), "opencrane-if-body-"));
	context.after(function _Cleanup() { rmSync(repository, { recursive: true, force: true }); });
	function _Git(...arguments_)
	{
		return execFileSync("git", arguments_, { cwd: repository, encoding: "utf8" }).trim();
	}
	_Git("init", "-q");
	_Git("config", "user.name", "OpenCrane test");
	_Git("config", "user.email", "test@opencrane.invalid");
	_Git("config", "commit.gpgSign", "false");
	writeFileSync(join(repository, "legacy.ts"), "if (legacy) return;\n");
	_Git("add", "legacy.ts");
	_Git("commit", "-m", "base without checker");
	const introductionBase = _Git("rev-parse", "HEAD");
	writeFileSync(join(repository, "legacy.ts"), "if (legacy) return;\nif (introduced) continue;\n");
	assert.equal(execFileSync(process.execPath, [_CHECKER, "--diff", introductionBase, "legacy.ts"], { cwd: repository, encoding: "utf8" }), "");
	_Git("checkout", "--", "legacy.ts");
	mkdirSync(join(repository, "scripts"));
	writeFileSync(join(repository, "scripts/if-body-newline-check.mjs"), "// activates the rule\n");
	writeFileSync(join(repository, "old.ts"), "if (inherited) return;\n");
	_Git("add", "scripts/if-body-newline-check.mjs", "old.ts");
	_Git("commit", "-m", "activate checker");
	const activeBase = _Git("rev-parse", "HEAD");
	_Git("mv", "old.ts", "renamed.ts");
	writeFileSync(join(repository, "renamed.ts"), "if (inherited) return;\nif (added) continue;\n");
	writeFileSync(join(repository, "batched.ts"), "if (batched) throw new Error();\n");
	writeFileSync(join(repository, "untracked.ts"), "if (untracked) return;\n");
	_Git("add", "renamed.ts", "batched.ts");
	const output = execFileSync(process.execPath, [_CHECKER, "--diff", activeBase, "renamed.ts", "batched.ts", "untracked.ts"], { cwd: repository, encoding: "utf8" });
	assert.deepEqual(output.trim().split("\n"), [
		"renamed.ts:2:continue;",
		"batched.ts:1:throw new Error();",
		"untracked.ts:1:return;",
	]);
});
