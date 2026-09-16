import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { runLocalDevelopmentLauncher } from "../launcher.mjs";

test("closing the terminal asks the worker to clean up", async function _TerminalHangup()
{
	const child = new EventEmitter();
	const processHost = new EventEmitter();
	const signals = [];
	processHost.env = {};
	processHost.execPath = "/usr/bin/node";
	processHost.platform = "darwin";
	function _Kill(signal)
	{
		signals.push(signal);
	}

	child.kill = _Kill;
	function _Spawn()
	{
		return child;
	}

	const completion = runLocalDevelopmentLauncher([], "/repo/scripts/local-development.mjs", {
		processHost,
		spawnProcess: _Spawn,
	});
	processHost.emit("SIGHUP");
	child.emit("close", 0, null);

	assert.equal(await completion, 0);
	assert.deepEqual(signals, ["SIGTERM"]);
	assert.equal(processHost.listenerCount("SIGHUP"), 0);
});
