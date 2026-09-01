import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const _ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** Run Git inside the fixture so its `HEAD` comparison cannot read the working repository. */
function _Git(repository, ...arguments_)
{
	execFileSync("git", arguments_, { cwd: repository, stdio: "ignore" });
}

test("large diff fan-out preserves the Prisma comparison base", function _PreservesPrismaDiffScope()
{
	const repository = mkdtempSync(join(tmpdir(), "opencrane-agent-style-"));
	try
	{
		mkdirSync(join(repository, "scripts", "__tests__"), { recursive: true });
		copyFileSync(join(_ROOT, "scripts", "agent-style-check.sh"), join(repository, "scripts", "agent-style-check.sh"));
		chmodSync(join(repository, "scripts", "agent-style-check.sh"), 0o755);
		writeFileSync(join(repository, "scripts", "inline-conditional-check.mjs"), "");
		writeFileSync(join(repository, "scripts", "if-body-newline-check.mjs"), "");
		writeFileSync(join(repository, "scripts", "prisma-boundary-check.mjs"), 'import { appendFileSync } from "node:fs"; appendFileSync(process.env.PRISMA_ARGUMENT_LOG, `${JSON.stringify(process.argv.slice(2))}\\n`);\n');
		_Git(repository, "init", "--quiet");
		_Git(repository, "config", "user.name", "OpenCrane Test");
		_Git(repository, "config", "user.email", "test@opencrane.local");
		_Git(repository, "commit", "--allow-empty", "--quiet", "-m", "base");
		for (let index = 0; index < 41; index += 1)
			writeFileSync(join(repository, `fixture-${index}.ts`), `const fixture${index} = ${index};\n`);
		const argumentLog = join(repository, "prisma-arguments.log");
		execFileSync(join(repository, "scripts", "agent-style-check.sh"), ["--diff", "HEAD"], { cwd: repository, env: { ...process.env, PRISMA_ARGUMENT_LOG: argumentLog }, stdio: "pipe" });
		assert.deepEqual(readFileSync(argumentLog, "utf8").trim().split("\n"), ['["--diff","HEAD"]']);
		execFileSync(join(repository, "scripts", "agent-style-check.sh"), ["fixture-0.ts"], { cwd: repository, env: { ...process.env, AGENT_STYLE_SKIP_PRISMA: "1", PRISMA_ARGUMENT_LOG: argumentLog }, stdio: "pipe" });
		assert.deepEqual(readFileSync(argumentLog, "utf8").trim().split("\n"), ['["--diff","HEAD"]', '["fixture-0.ts"]']);
	}
	finally
	{
		rmSync(repository, { recursive: true, force: true });
	}
});
