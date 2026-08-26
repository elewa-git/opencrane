import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { LOCAL_DEVELOPMENT_WORKER_ENVIRONMENT, shouldRunLocalDevelopmentWorker, runLocalDevelopmentLauncher } from "../local-development/launcher.mjs";

function _Fixture()
{
	const child = new EventEmitter();
	const childSignals = [];
	const processHost = new EventEmitter();
	const processSignals = [];
	let spawnArguments;
	let spawnOptions;
	processHost.env = { PATH: "/usr/bin" };
	processHost.execPath = "/usr/bin/node";
	processHost.platform = "darwin";
	processHost.kill = function _SignalProcessGroup(processId, signal) { processSignals.push({ processId, signal }); };
	child.kill = function _SignalWorker(signal) { childSignals.push(signal); };
	const session = runLocalDevelopmentLauncher(["--profile", "agent"], "/repo/scripts/local-development.mjs", {
		processHost,
		spawnProcess(_command, argumentsList, options)
		{
			spawnArguments = argumentsList;
			spawnOptions = options;
			return child;
		}
	});

	return {
		child,
		childSignals,
		processHost,
		processSignals,
		session,
		spawnArguments: function _SpawnArguments() { return spawnArguments; },
		spawnOptions: function _SpawnOptions() { return spawnOptions; }
	};
}

test("the launcher forwards one interrupt and waits for coordinator cleanup", async function _OneInterrupt()
{
	const fixture = _Fixture();
	let completed = false;
	fixture.session.then(function _Completed() { completed = true; });

	fixture.processHost.emit("SIGINT");
	fixture.processHost.emit("SIGINT");
	await new Promise(function _WaitTurn(resolve) { setImmediate(resolve); });

	assert.deepEqual(fixture.childSignals, ["SIGINT"]);
	assert.equal(completed, false);
	assert.deepEqual(fixture.spawnArguments(), ["/repo/scripts/local-development.mjs", "--profile", "agent"]);
	assert.equal(fixture.spawnOptions().detached, true);
	assert.equal(fixture.spawnOptions().env[LOCAL_DEVELOPMENT_WORKER_ENVIRONMENT], "true");

	fixture.child.emit("close", 0, null);
	assert.equal(await fixture.session, 0);
	assert.equal(fixture.processHost.listenerCount("SIGINT"), 0);
});

test("a suspend request resumes the terminal group and asks the worker to shut down", async function _SuspendAsShutdown()
{
	const fixture = _Fixture();

	fixture.processHost.emit("SIGTSTP");
	fixture.child.emit("close", 0, null);
	await fixture.session;

	assert.deepEqual(fixture.processSignals, [{ processId: 0, signal: "SIGCONT" }]);
	assert.deepEqual(fixture.childSignals, ["SIGINT"]);
});

test("Windows runs the coordinator in the foreground so console interrupts retain cleanup", function _WindowsWorker()
{
	assert.equal(shouldRunLocalDevelopmentWorker("win32", {}), true);
	assert.equal(shouldRunLocalDevelopmentWorker("darwin", { [LOCAL_DEVELOPMENT_WORKER_ENVIRONMENT]: "true" }), true);
	assert.equal(shouldRunLocalDevelopmentWorker("linux", {}), false);
});
