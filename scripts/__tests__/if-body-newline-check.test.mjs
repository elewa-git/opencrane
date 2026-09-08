import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

test("keeps added-line scope when the shell checker fans out a large diff", function _Test(context)
{
	const repository = mkdtempSync(join(tmpdir(), "opencrane-style-chunks-"));
	context.after(function _Cleanup() { rmSync(repository, { recursive: true, force: true }); });
	function _Git(...arguments_)
	{
		return execFileSync("git", arguments_, { cwd: repository, encoding: "utf8" }).trim();
	}
	_Git("init", "-q");
	_Git("config", "user.name", "OpenCrane test");
	_Git("config", "user.email", "test@opencrane.invalid");
	_Git("config", "commit.gpgSign", "false");
	mkdirSync(join(repository, "scripts"));
	const shell = join(repository, "scripts/agent-style-check.sh");
	copyFileSync(fileURLToPath(new URL("../agent-style-check.sh", import.meta.url)), shell);
	chmodSync(shell, 0o755);
	mkdirSync(join(repository, "node_modules"));
	symlinkSync(dirname(dirname(fileURLToPath(import.meta.resolve("typescript")))), join(repository, "node_modules/typescript"));
	for (const name of ["if-body-newline-check.mjs", "inline-conditional-check.mjs"])
		copyFileSync(fileURLToPath(new URL("../" + name, import.meta.url)), join(repository, "scripts", name));
	// The real shell and AST checks run here; Prisma ownership is outside this scope regression.
	writeFileSync(join(repository, "scripts/prisma-boundary-check.mjs"), "process.exit(0);\n");
	// Declaration files cross the batching threshold without repeating unrelated AST work.
	const files = Array.from({ length: 41 }, function _Name(_, index) { return "file-" + index + (index === 0 ? ".ts" : ".d.ts"); });
	for (const file of files)
		writeFileSync(join(repository, file), "if (inherited) return;\n");
	_Git("add", ".");
	_Git("commit", "-m", "active checker and inherited code");
	const base = _Git("rev-parse", "HEAD");
	for (const file of files)
		writeFileSync(join(repository, file), "if (inherited) return;\n// This changed line is unrelated to the inherited condition.\n");
	const environment = { ...process.env };
	delete environment.AGENT_STYLE_CHUNK;
	delete environment.AGENT_STYLE_IF_DIFF_BASE;
	const options = { cwd: repository, env: environment, encoding: "utf8" };
	const output = execFileSync(shell, ["--diff", base], options);
	assert.doesNotMatch(output, /IF-BODY-NEWLINE/u);
	assert.match(output, /1 file\(s\) checked/u);
	assert.match(output, /no checkable TypeScript files in scope/u);
	writeFileSync(join(repository, files[0]), "if (inherited) return;\nif (added) continue;\n");
	assert.throws(function _CheckNewViolation() { execFileSync(shell, ["--diff", base], options); }, function _VerifyFailure(error)
	{
		assert.notEqual(error.status, 0);
		assert.match(error.stdout, /file-0\.ts:2\tERROR\tIF-BODY-NEWLINE/u);
		assert.doesNotMatch(error.stdout, /file-0\.ts:1\tERROR\tIF-BODY-NEWLINE/u);
		return true;
	});
	assert.throws(function _CheckExplicitFiles() { execFileSync(shell, files, options); }, function _VerifyExplicitFailure(error)
	{
		assert.notEqual(error.status, 0);
		assert.match(error.stdout, /file-0\.ts:1\tERROR\tIF-BODY-NEWLINE/u);
		return true;
	});
});
