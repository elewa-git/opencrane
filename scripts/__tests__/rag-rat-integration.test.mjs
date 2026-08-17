import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ___RunAgentContextProcess } from "../rag-rat/process.mjs";
import { ___EnsureRagRatRuntime, ___RagRatNpmInvocation, ___RagRatRuntimeIsCurrent } from "../rag-rat/runtime.mjs";
import { ___RunRagRatWorkflow } from "../rag-rat/workflows.mjs";

const _ROOT = new URL("../../", import.meta.url);
const _PACKAGE_JSON = JSON.parse(readFileSync(new URL("package.json", _ROOT), "utf8"));
const _RUNTIME_SOURCE = readFileSync(new URL("scripts/rag-rat/runtime.mjs", _ROOT), "utf8");
const _CONFIG = readFileSync(new URL("rag-rat.toml", _ROOT), "utf8");
const _GITIGNORE = readFileSync(new URL(".gitignore", _ROOT), "utf8");

test("pins the opt-in binary without adding it to ordinary dependency installation", function _PinsOptInBinary()
{
	assert.match(_RUNTIME_SOURCE, /const _VERSION = "0\.23\.0"/);
	assert.match(_RUNTIME_SOURCE, /const _PACKAGE = `@rag-rat\/bin@\$\{_VERSION\}`/);
	assert.equal(_PACKAGE_JSON.dependencies?.["@rag-rat/bin"], undefined);
	assert.equal(_PACKAGE_JSON.devDependencies?.["@rag-rat/bin"], undefined);
});

test("launches npm through Node or an explicit Windows command shell", function _SelectsNpmInvocation()
{
	assert.deepEqual(___RagRatNpmInvocation("win32", "C:\\node.exe", "C:\\npm-cli.js"), {
		command: "C:\\node.exe",
		argumentPrefix: ["C:\\npm-cli.js"],
	});
	assert.deepEqual(___RagRatNpmInvocation("win32", "C:\\node.exe", undefined), {
		command: "cmd.exe",
		argumentPrefix: ["/d", "/s", "/c", "npm.cmd"],
	});
	assert.deepEqual(___RagRatNpmInvocation("linux", "/usr/bin/node", undefined), {
		command: "npm",
		argumentPrefix: [],
	});
});

test("accepts only a matching package version and executable digest", function _ChecksRuntimeIdentity(t)
{
	const fixture = mkdtempSync(join(tmpdir(), "opencrane-rag-rat-runtime-"));
	t.after(function _RemoveFixture()
	{
		rmSync(fixture, { force: true, recursive: true });
	});
	const manifest = join(fixture, "package.json");
	const executable = join(fixture, "rag-rat");
	const digest = "bdb66e892d64be546c733836e37f400f3aef88afb9e184284804ea19f555c69b";

	assert.equal(___RagRatRuntimeIsCurrent(manifest, executable, "0.23.0", digest), false);
	writeFileSync(manifest, JSON.stringify({ version: "0.22.0" }));
	writeFileSync(executable, "reviewed-binary");
	assert.equal(___RagRatRuntimeIsCurrent(manifest, executable, "0.23.0", digest), false);
	writeFileSync(manifest, JSON.stringify({ version: "0.23.0" }));
	assert.equal(___RagRatRuntimeIsCurrent(manifest, executable, "0.23.0", digest), true);
	writeFileSync(executable, "replaced-binary");
	assert.equal(___RagRatRuntimeIsCurrent(manifest, executable, "0.23.0", digest), false);
});

test("retains the reviewed executable digest for every supported developer platform", function _PinsPlatformDigests()
{
	const digests = [
		"223060f897fb6d33cbec5dd64fe3227ff2a1740751492211c3b5fb093cc41b25",
		"fcf17592f6de9f2f0bad4ea19b9d400b163b3ddbe99c5a45aa8f7b99fc83a542",
		"2cdcddf4595eb9dbc904749c987938716bdfb8464362ebe4917f0ef45b9659ff",
		"1857d4875399a54fd393dc3d8327c0598ae0fe0838939d9f4618805a13ef7491",
	];

	for (const digest of digests)
	{
		assert.match(_RUNTIME_SOURCE, new RegExp(digest));
	}
});

function _CreateRuntimeFixture(t)
{
	const runtimeParent = mkdtempSync(join(tmpdir(), "opencrane-rag-rat-install-"));
	const binary = "reviewed-binary";
	const sha256 = "bdb66e892d64be546c733836e37f400f3aef88afb9e184284804ea19f555c69b";
	const platforms = Object.freeze({ "test-x64": Object.freeze({ executable: "rag-rat", sha256 }) });
	t.after(function _RemoveRuntimeFixture()
	{
		rmSync(runtimeParent, { force: true, recursive: true });
	});

	function install(prefix, version = "0.23.0", contents = binary, ready = false)
	{
		const packageRoot = join(prefix, "node_modules", "@rag-rat", "bin");
		const executableRoot = join(packageRoot, "node_modules", ".bin_real");
		mkdirSync(executableRoot, { recursive: true });
		writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ version }));
		writeFileSync(join(executableRoot, "rag-rat"), contents);
		if (ready)
		{
			writeFileSync(join(prefix, ".ready"), JSON.stringify({ version }));
		}
	}

	return Object.freeze({ binary, install, platforms, runtimeParent });
}

function _RuntimeOptions(fixture, runInstaller)
{
	return {
		architecture: "x64",
		candidateId: "test",
		nodeExecutable: "/usr/bin/node",
		platform: "test",
		platforms: fixture.platforms,
		runInstaller,
		runtimeParent: fixture.runtimeParent,
	};
}

test("replaces a stale runtime and promotes only reviewed bytes", function _ReplacesStaleRuntime(t)
{
	const fixture = _CreateRuntimeFixture(t);
	fixture.install(join(fixture.runtimeParent, "0.23.0-stale"), "0.22.0", fixture.binary, true);
	let installCalls = 0;
	const result = ___EnsureRagRatRuntime(_RuntimeOptions(fixture, function _Install(_command, arguments_)
	{
		installCalls += 1;
		fixture.install(arguments_[arguments_.indexOf("--prefix") + 1]);
		return { status: 0 };
	}));

	assert.equal(result.status, 0);
	assert.equal(installCalls, 1);
	assert.equal(readFileSync(result.executable, "utf8"), fixture.binary);
});

test("cleans a failed installation before returning its status", function _CleansFailedInstall(t)
{
	const fixture = _CreateRuntimeFixture(t);
	const result = ___EnsureRagRatRuntime(_RuntimeOptions(fixture, function _FailInstall(_command, arguments_)
	{
		mkdirSync(arguments_[arguments_.indexOf("--prefix") + 1], { recursive: true });
		return { status: 7, errorMessage: "registry unavailable" };
	}));

	assert.equal(result.status, 7);
	assert.equal(result.errorMessage, "registry unavailable");
	assert.equal(existsSync(join(fixture.runtimeParent, "0.23.0-test")), false);
});

test("removes an installed executable whose digest was not reviewed", function _RejectsUnreviewedBytes(t)
{
	const fixture = _CreateRuntimeFixture(t);
	const result = ___EnsureRagRatRuntime(_RuntimeOptions(fixture, function _InstallTampered(_command, arguments_)
	{
		fixture.install(arguments_[arguments_.indexOf("--prefix") + 1], "0.23.0", "tampered-binary");
		return { status: 0 };
	}));

	assert.equal(result.status, 1);
	assert.match(result.errorMessage, /SHA-256/);
	assert.equal(existsSync(join(fixture.runtimeParent, "0.23.0-test")), false);
});

test("rejects unsupported platforms before npm", function _RejectsUnsupportedPlatform(t)
{
	const fixture = _CreateRuntimeFixture(t);
	let installCalls = 0;
	const unsupported = ___EnsureRagRatRuntime({
		..._RuntimeOptions(fixture, function _CountInstall()
		{
			installCalls += 1;
			return { status: 0 };
		}),
		architecture: "riscv64",
	});
	assert.equal(unsupported.status, 1);
	assert.equal(installCalls, 0);
});

test("ignores a crashed candidate and publishes a separate verified candidate", function _IgnoresCrashedCandidate(t)
{
	const fixture = _CreateRuntimeFixture(t);
	fixture.install(join(fixture.runtimeParent, "0.23.0-crashed"));
	const recovered = ___EnsureRagRatRuntime({
		..._RuntimeOptions(fixture, function _Install(_command, arguments_)
		{
			fixture.install(arguments_[arguments_.indexOf("--prefix") + 1]);
			return { status: 0 };
		}),
		candidateId: "recovered",
	});

	assert.equal(recovered.status, 0);
	assert.match(recovered.executable, /0\.23\.0-recovered/);
	assert.equal(existsSync(join(fixture.runtimeParent, "0.23.0-recovered", ".ready")), true);
});

test("reuses a ready reviewed candidate without invoking npm", function _ReusesReviewedCandidate(t)
{
	const fixture = _CreateRuntimeFixture(t);
	fixture.install(join(fixture.runtimeParent, "0.23.0-reviewed"), "0.23.0", fixture.binary, true);
	let installCalls = 0;
	const reused = ___EnsureRagRatRuntime(_RuntimeOptions(fixture, function _UnexpectedInstall()
	{
		installCalls += 1;
		return { status: 1 };
	}));

	assert.equal(reused.status, 0);
	assert.match(reused.executable, /0\.23\.0-reviewed/);
	assert.equal(installCalls, 0);
});

test("normalizes launch errors and missing exit statuses", function _NormalizesProcesses()
{
	const options = { cwd: "/repo", env: {} };
	const failed = ___RunAgentContextProcess("tool", ["arg"], options, function _FailLaunch()
	{
		return { error: new Error("missing executable"), status: null };
	});
	const interrupted = ___RunAgentContextProcess("tool", [], options, function _Interrupt()
	{
		return { status: null };
	});

	assert.deepEqual(failed, { status: 1, errorMessage: "missing executable" });
	assert.deepEqual(interrupted, { status: 1 });
});

test("runs setup in order and stops before commands after a failure", function _StopsWorkflowOnFailure()
{
	const commands = [];
	const status = ___RunRagRatWorkflow("setup", [], function _Run(arguments_)
	{
		commands.push(arguments_);
		return commands.length === 2 ? 9 : 0;
	});

	assert.equal(status, 9);
	assert.deepEqual(commands, [
		["index", "--full"],
		["models", "install", "minishlab/potion-retrieval-32M"],
	]);
});

test("passes native commands and arguments through unchanged", function _PassesThroughNativeCommand()
{
	let received;
	const status = ___RunRagRatWorkflow("query", ["run admission"], function _Run(arguments_)
	{
		received = arguments_;
		return 0;
	});

	assert.equal(status, 0);
	assert.deepEqual(received, ["query", "run admission"]);
});

test("exposes setup, refresh, health, and passthrough commands", function _ExposesWorkspaceCommands()
{
	assert.equal(_PACKAGE_JSON.scripts["agent-context"], "node scripts/rag-rat.mjs");
	assert.equal(_PACKAGE_JSON.scripts["agent-context:setup"], "node scripts/rag-rat.mjs setup");
	assert.equal(_PACKAGE_JSON.scripts["agent-context:refresh"], "node scripts/rag-rat.mjs refresh");
	assert.equal(_PACKAGE_JSON.scripts["agent-context:doctor"], "node scripts/rag-rat.mjs doctor");
});

test("keeps generated, vendored, and machine-local context outside the repository index contract", function _ExcludesNonAuthoritativeContext()
{
	assert.match(_CONFIG, /exclude = \["\*\*\/\.upstream\/\*\*"/);
	assert.match(_CONFIG, /"\*\*\/generated\/\*\*"/);
	assert.match(_CONFIG, /\[version_check\]\nenabled = false/);
	assert.match(_GITIGNORE, /^\.rag-rat\/$/m);
});
