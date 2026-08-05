import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	evaluateGrowth,
	isProductionSource,
	resolveExceptions,
	validateConfiguration,
} from "../module-growth/core.mjs";

const _SourceExtensions = [
	".go",
	".java",
	".js",
	".mjs",
	".prisma",
	".py",
	".rs",
	".sh",
	".tf",
	".ts",
];
const _RepositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

test("recognizes hand-maintained production source across languages", () =>
{
	assert.equal(isProductionSource("apps/runtime/src/runtime.py", _SourceExtensions), true);
	assert.equal(isProductionSource("libs/backend/src/service.ts", _SourceExtensions), true);
	assert.equal(isProductionSource("services/worker/main.go", _SourceExtensions), true);
	assert.equal(isProductionSource("services/indexer/src/lib.rs", _SourceExtensions), true);
	assert.equal(isProductionSource("services/api/src/Main.java", _SourceExtensions), true);
	assert.equal(isProductionSource("apps/_infra/deploy-k8s/platform/provision.sh", _SourceExtensions), true);
	assert.equal(isProductionSource("apps/opencrane/prisma/schema/agent.prisma", _SourceExtensions), true);
	assert.equal(isProductionSource("platform/gke/main.tf", _SourceExtensions), true);
});

test("excludes tests, generated output, dependencies, and fixtures", () =>
{
	assert.equal(isProductionSource("apps/runtime/tests/test_runtime.py", _SourceExtensions), false);
	assert.equal(isProductionSource("libs/backend/src/__tests__/service.test.ts", _SourceExtensions), false);
	assert.equal(isProductionSource("libs/contracts/src/generated/api.ts", _SourceExtensions), false);
	assert.equal(isProductionSource("vendor/library/source.go", _SourceExtensions), false);
	assert.equal(isProductionSource("apps/tool/fixtures/large.js", _SourceExtensions), false);
	assert.equal(isProductionSource("services/api/src/test/java/Foo.java", _SourceExtensions), false);
	assert.equal(isProductionSource("services/indexer/spec/indexer_spec.rb", _SourceExtensions), false);
	assert.equal(isProductionSource("scripts/workload-ownership-app-composition-boundary-negative-tests.sh", _SourceExtensions), false);
});

test("warns when a change adds a large cohesive-review candidate", () =>
{
	assert.deepEqual(
		evaluateGrowth({
			addedLines: 151,
			baseLines: 100,
			currentLines: 251,
			exempt: false,
			largeAdditionLines: 150,
			maximumLines: 500,
			warningLines: 350,
		}),
		[{
			level: "WARN",
			rule: "MODULE-GROWTH-REVIEW",
			message: "151 lines added; module grew from 100 to 251 lines — inventory responsibilities and run the maintainability review dimension",
		}],
	);
});

test("blocks growth beyond the hard maximum but not reduction", () =>
{
	const growth = evaluateGrowth({
		addedLines: 20,
		baseLines: 495,
		currentLines: 515,
		exempt: false,
		largeAdditionLines: 150,
		maximumLines: 500,
		warningLines: 350,
	});
	assert.equal(growth[0].level, "ERROR");
	assert.equal(growth[0].rule, "MODULE-GROWTH-LIMIT");
	assert.equal(growth[1].level, "WARN");

	assert.deepEqual(evaluateGrowth({
		addedLines: 0,
		baseLines: 600,
		currentLines: 550,
		exempt: false,
		largeAdditionLines: 150,
		maximumLines: 500,
		warningLines: 350,
	}), []);
});

test("an active exception suppresses only the hard failure", () =>
{
	assert.deepEqual(evaluateGrowth({
		addedLines: 20,
		baseLines: 495,
		currentLines: 515,
		exempt: true,
		largeAdditionLines: 150,
		maximumLines: 500,
		warningLines: 350,
	}), [{
		level: "WARN",
		rule: "MODULE-GROWTH-REVIEW",
		message: "20 lines added; module grew from 495 to 515 lines — inventory responsibilities and run the maintainability review dimension",
	}]);
});

test("requires exact, owned, reasoned, temporary exceptions", () =>
{
	const entries = [
		{
			path: "apps/runtime/src/runtime.py",
			owner: "runtime-team",
			reason: "Split is blocked on the accepted transport contract.",
			expiresOn: "2026-08-30",
		},
		{
			path: "apps/*/src/index.ts",
			owner: "",
			reason: "too short",
			expiresOn: "not-a-date",
		},
		{
			path: "../apps/runtime/src/runtime.py",
			owner: "runtime-team",
			reason: "A parent-relative exception must never match repository source.",
			expiresOn: "2026-08-30",
		},
		{
			path: "apps/blank-owner/src/runtime.py",
			owner: "   ",
			reason: "                    ",
			expiresOn: "2026-08-30",
		},
		{
			path: "apps/expired/src/main.go",
			owner: "platform-team",
			reason: "Temporary exception that is already beyond its expiry.",
			expiresOn: "2026-07-01",
		},
	];
	const result = resolveExceptions(entries, "2026-07-30");

	assert.equal(result.active.size, 1);
	assert.equal(result.active.has("apps/runtime/src/runtime.py"), true);
	assert.equal(result.errors.length, 4);
	assert.match(result.errors[0], /invalid exception/u);
	assert.match(result.errors[1], /invalid exception/u);
	assert.match(result.errors[2], /invalid exception/u);
	assert.match(result.errors[3], /expired exception/u);
});

test("rejects invalid threshold configuration", () =>
{
	assert.throws(() => validateConfiguration({
		version: 1,
		warningLines: 500,
		maximumLines: 350,
		largeAdditionLines: 150,
		sourceExtensions: [".ts"],
		exceptions: [],
	}), /invalid schema or threshold order/u);
});

test("keeps every review-agent surface on the maintainability gate", () =>
{
	const reviewAgentPaths = [
		".agents/skills/review/SKILL.md",
		".claude/agents/review.md",
		".codex/agents/review.toml",
	];
	for (const path of reviewAgentPaths)
	{
		const content = readFileSync(join(_RepositoryRoot, path), "utf8");
		assert.match(content, /correctness \| security \| maintainability \| residue/u);
		assert.match(content, /check:module-growth/u);
		assert.match(content, /exact base and head SHAs|exact base SHA and head SHA/u);
		assert.match(content, /diff --cached --binary/u);
		assert.match(content, /incremental/u);
		assert.match(content, /cumulative/u);
	}

	const codexHook = readFileSync(
		join(_RepositoryRoot, ".codex/hooks/require-review.sh"),
		"utf8",
	);
	assert.match(codexHook, /\.claude\/hooks\/require-review\.sh/u);
	assert.doesNotMatch(codexHook, /git diff HEAD -- '\*\.ts'/u);

	const sharedHook = readFileSync(
		join(_RepositoryRoot, ".claude/hooks/require-review.sh"),
		"utf8",
	);
	assert.match(sharedHook, /pr-stack-integrity\.mjs/u);
	assert.match(sharedHook, /git diff --cached --binary HEAD/u);
	assert.match(sharedHook, /git ls-files --others --exclude-standard -z/u);
	assert.match(sharedHook, /git rev-parse HEAD/u);

	const styleCheck = readFileSync(join(_RepositoryRoot, "scripts/agent-style-check.sh"), "utf8");
	assert.match(styleCheck, /ls-files --others --exclude-standard -z -- '\*\.ts'/u);
	const prismaCheck = readFileSync(join(_RepositoryRoot, "scripts/prisma-boundary-check.mjs"), "utf8");
	assert.match(prismaCheck, /ls-files", "--others", "--exclude-standard", "-z"/u);
});

test("Codex Stop wrapper blocks JUDGE and allows SKIP", (context) =>
{
	const repository = mkdtempSync(join(tmpdir(), "opencrane-review-wrapper-"));
	context.after(() => rmSync(repository, { recursive: true, force: true }));
	const sharedHook = join(repository, ".claude/hooks/require-review.sh");
	mkdirSync(dirname(sharedHook), { recursive: true });
	writeFileSync(
		sharedHook,
		[
			"#!/usr/bin/env bash",
			"cat >/dev/null",
			"printf 'VERDICT=%s\\n' \"$HOOK_TEST_VERDICT\" > \"$CLAUDE_PROJECT_DIR/.claude/.review-context.md\"",
			"",
		].join("\n"),
	);
	const wrapper = join(_RepositoryRoot, ".codex/hooks/require-review.sh");
	const invoke = (verdict) => spawnSync("bash", [wrapper], {
		encoding: "utf8",
		env: {
			...process.env,
			CODEX_PROJECT_DIR: repository,
			HOOK_TEST_VERDICT: verdict,
		},
		input: JSON.stringify({ stop_hook_active: verdict === "SKIP" }),
	});

	const judge = invoke("JUDGE");
	assert.equal(judge.status, 0);
	assert.equal(JSON.parse(judge.stdout).decision, "block");

	const skip = invoke("SKIP");
	assert.equal(skip.status, 0);
	assert.equal(JSON.parse(skip.stdout).continue, true);

	writeFileSync(sharedHook, "#!/usr/bin/env bash\nexit 1\n");
	const crashed = invoke("SKIP");
	assert.equal(crashed.status, 0);
	assert.equal(JSON.parse(crashed.stdout).decision, "block");
});

test("shared Stop pre-filter routes checker crashes to JUDGE", (context) =>
{
	const repository = mkdtempSync(join(tmpdir(), "opencrane-review-failure-"));
	context.after(() => rmSync(repository, { recursive: true, force: true }));
	const fakeBin = join(repository, "fake-bin");
	const fakeNode = join(fakeBin, "node");
	const sourcePath = join(repository, "apps/runtime.py");
	mkdirSync(fakeBin, { recursive: true });
	mkdirSync(join(repository, ".claude"), { recursive: true });
	mkdirSync(dirname(sourcePath), { recursive: true });
	writeFileSync(sourcePath, "value = 1\n");
	writeFileSync(
		fakeNode,
		[
			"#!/usr/bin/env bash",
			"if [ \"$1\" = \"-e\" ]; then",
			"  printf '%s\\n' ':(icase)*.py'",
			"  exit 0",
			"fi",
			"printf '%s\\n' 'synthetic checker failure' >&2",
			"exit 1",
			"",
		].join("\n"),
	);
	chmodSync(fakeNode, 0o755);
	execFileSync("git", ["init", "--quiet"], { cwd: repository });

	const sharedHook = join(_RepositoryRoot, ".claude/hooks/require-review.sh");
	const result = spawnSync("bash", [sharedHook], {
		cwd: repository,
		encoding: "utf8",
		env: {
			...process.env,
			CLAUDE_PROJECT_DIR: repository,
			PATH: `${fakeBin}:${process.env.PATH}`,
		},
		input: JSON.stringify({ stop_hook_active: false }),
	});

	assert.equal(result.status, 0);
	const reviewContext = readFileSync(
		join(repository, ".claude/.review-context.md"),
		"utf8",
	);
	assert.match(reviewContext, /^VERDICT=JUDGE/mu);
	assert.match(reviewContext, /synthetic checker failure/u);
});

test("CLI fails when a changed Python module grows beyond the maximum", (context) =>
{
	const repository = mkdtempSync(join(tmpdir(), "opencrane-module-growth-"));
	context.after(() => rmSync(repository, { recursive: true, force: true }));
	const configurationPath = join(repository, "docs/agents/module-growth-policy.json");
	const sourcePath = join(repository, "apps/runtime/src/runtime.py");
	mkdirSync(dirname(configurationPath), { recursive: true });
	mkdirSync(dirname(sourcePath), { recursive: true });
	writeFileSync(configurationPath, JSON.stringify({
		version: 1,
		warningLines: 350,
		maximumLines: 500,
		largeAdditionLines: 150,
		sourceExtensions: [".py"],
		exceptions: [],
	}));
	writeFileSync(sourcePath, "value = 1\n".repeat(495));
	execFileSync("git", ["init", "--quiet"], { cwd: repository });
	execFileSync("git", ["add", "."], { cwd: repository });
	execFileSync(
		"git",
		[
			"-c",
			"user.name=Module Growth Test",
			"-c",
			"user.email=module-growth@example.invalid",
			"-c",
			"commit.gpgsign=false",
			"commit",
			"--quiet",
			"-m",
			"baseline",
		],
		{ cwd: repository },
	);
	writeFileSync(sourcePath, "value = 1\n".repeat(501));

	const executable = fileURLToPath(new URL("../module-growth-check.mjs", import.meta.url));
	const result = spawnSync(process.execPath, [executable], {
		cwd: repository,
		encoding: "utf8",
	});

	assert.equal(result.status, 1);
	assert.match(result.stdout, /ERROR\s+MODULE-GROWTH-LIMIT/u);
	assert.match(result.stdout, /grew from 495/u);
});

test("CLI preserves the baseline across a pure rename", (context) =>
{
	const repository = mkdtempSync(join(tmpdir(), "opencrane-module-growth-rename-"));
	context.after(() => rmSync(repository, { recursive: true, force: true }));
	const configurationPath = join(repository, "docs/agents/module-growth-policy.json");
	const originalPath = join(repository, "apps/runtime/src/legacy_runtime.py");
	const renamedRelativePath = "apps/runtime/src/runtime.py";
	const renamedPath = join(repository, renamedRelativePath);
	mkdirSync(dirname(configurationPath), { recursive: true });
	mkdirSync(dirname(originalPath), { recursive: true });
	writeFileSync(configurationPath, JSON.stringify({
		version: 1,
		warningLines: 350,
		maximumLines: 500,
		largeAdditionLines: 150,
		sourceExtensions: [".py"],
		exceptions: [],
	}));
	writeFileSync(originalPath, "value = 1\n".repeat(501));
	execFileSync("git", ["init", "--quiet"], { cwd: repository });
	execFileSync("git", ["add", "."], { cwd: repository });
	execFileSync(
		"git",
		[
			"-c",
			"user.name=Module Growth Test",
			"-c",
			"user.email=module-growth@example.invalid",
			"-c",
			"commit.gpgsign=false",
			"commit",
			"--quiet",
			"-m",
			"baseline",
		],
		{ cwd: repository },
	);
	execFileSync("git", ["mv", originalPath, renamedPath], { cwd: repository });

	const executable = fileURLToPath(new URL("../module-growth-check.mjs", import.meta.url));
	const result = spawnSync(process.execPath, [executable], {
		cwd: repository,
		encoding: "utf8",
	});

	assert.equal(result.status, 0);
	assert.doesNotMatch(result.stdout, /MODULE-GROWTH-/u);
	assert.match(result.stdout, /0 error\(s\), 0 review candidate\(s\)/u);

	const scopedResult = spawnSync(process.execPath, [executable, renamedRelativePath], {
		cwd: repository,
		encoding: "utf8",
	});

	assert.equal(scopedResult.status, 0);
	assert.doesNotMatch(scopedResult.stdout, /MODULE-GROWTH-/u);

	execFileSync("git", ["rm", "--force", "--quiet", renamedRelativePath], { cwd: repository });
	const deletedResult = spawnSync(process.execPath, [executable, renamedRelativePath], {
		cwd: repository,
		encoding: "utf8",
	});

	assert.equal(deletedResult.status, 0);
	assert.match(deletedResult.stdout, /0 production source file\(s\) checked/u);
});
