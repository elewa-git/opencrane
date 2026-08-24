import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { prepareLocalAgentRuntimeEnvironment } from "../local-development/python-runtime.mjs";

test("Agent profiles create and reuse a repository-owned runtime environment", function _PrepareRuntime(t)
{
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencrane-runtime-python-"));
	t.after(function _Cleanup() { fs.rmSync(root, { recursive: true, force: true }); });
	const virtualEnvironment = path.join(root, ".venv");
	const configuration = {
		profile: "agent",
		runtimeVirtualEnvironmentPath: virtualEnvironment,
		runtimePythonPath: path.join(virtualEnvironment, "bin/python"),
		runtimeRequirementsPath: path.join(root, "requirements.txt"),
		runtimeRequirementsStampPath: path.join(virtualEnvironment, ".opencrane-requirements.sha256")
	};
	fs.writeFileSync(configuration.runtimeRequirementsPath, "cryptography==48.0.1\n");
	const calls = [];
	let installed = false;
	const runCommand = function _Run(command, argumentsList)
	{
		calls.push([command, ...argumentsList]);

		if (command === "python3")
		{
			fs.mkdirSync(path.dirname(configuration.runtimePythonPath), { recursive: true });
			fs.writeFileSync(configuration.runtimePythonPath, "python");
		}
		else if (argumentsList.includes("pip"))
		{
			installed = true;
		}
		else if (!installed)
		{
			throw new Error("dependencies unavailable");
		}
	};

	assert.equal(prepareLocalAgentRuntimeEnvironment(configuration, runCommand), true);
	assert.equal(calls.some(call => call.includes("venv")), true);
	assert.equal(calls.some(call => call.includes("pip")), true);
	const firstCallCount = calls.length;
	assert.equal(prepareLocalAgentRuntimeEnvironment(configuration, runCommand), false);
	assert.equal(calls.length, firstCallCount + 1);
});

test("core does not prepare a Python runtime", function _SkipCore()
{
	let called = false;
	const prepared = prepareLocalAgentRuntimeEnvironment({ profile: "core" }, function _UnexpectedCommand()
	{
		called = true;
	});

	assert.equal(prepared, false);
	assert.equal(called, false);
});
