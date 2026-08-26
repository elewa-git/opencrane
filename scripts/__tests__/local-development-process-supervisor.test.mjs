import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { runLocalCommand } from "../local-development/command-runner.mjs";
import { createDevelopmentChildEnvironment, runDevelopmentProcesses } from "../local-development/process-supervisor.mjs";

test("spawned processes inherit only reviewed toolchain variables from the developer shell", function _removesParentCredentials()
{
	const environment = createDevelopmentChildEnvironment({
		PATH: "/usr/bin",
		HOME: "/home/developer",
		OPENAI_API_KEY: "parent-provider-key",
		LITELLM_MASTER_KEY: "parent-master-key",
		OPENCRANE_INITIAL_MODEL_API_KEY: "parent-initial-key",
		GH_TOKEN: "github-token",
		AWS_SECRET_ACCESS_KEY: "aws-secret"
	});

	assert.deepEqual(environment, {
		HOME: "/home/developer",
		PATH: "/usr/bin"
	});
});

test("an application process receives only the model credential its profile supplies explicitly", function _keepsExplicitCredential()
{
	const environment = createDevelopmentChildEnvironment({
		PATH: "/usr/bin",
		LITELLM_MASTER_KEY: "stale-parent-key"
	}, {
		LITELLM_MASTER_KEY: "selected-profile-key"
	});

	assert.equal(environment.LITELLM_MASTER_KEY, "selected-profile-key");
});

test("a setup command returns its captured output after successful completion", async function _RunSetupCommand()
{
	const result = await runLocalCommand(process.execPath, ["-e", "process.stdout.write('ready')"]);

	assert.equal(result.status, 0);
	assert.equal(result.stdout, "ready");
});

test("explicit Tier 2 listener ports override conflicting parent values", function _FixedListenerPorts()
{
	const environment = createDevelopmentChildEnvironment({
		PORT: "9090",
		INTERNAL_PORT: "9091",
		AWS_ACCESS_KEY_ID: "parent-access-key"
	}, {
		PORT: "8080",
		INTERNAL_PORT: "8081"
	});

	assert.equal(environment.PORT, "8080");
	assert.equal(environment.INTERNAL_PORT, "8081");
	assert.equal(environment.AWS_ACCESS_KEY_ID, undefined);
});

test("a terminal suspend request resumes the process group and completes graceful shutdown", async function _SuspendStopsSession()
{
	const processHost = new EventEmitter();
	const processSignals = [];
	const childSignals = [];
	processHost.env = { PATH: "/usr/bin" };
	processHost.platform = "darwin";
	processHost.kill = function _SignalProcessGroup(processId, signal)
	{
		processSignals.push({ processId, signal });
	};

	const child = new EventEmitter();
	child.kill = function _SignalChild(signal)
	{
		childSignals.push(signal);
		queueMicrotask(function _CloseChild() { child.emit("close", 0, signal); });
	};

	const session = runDevelopmentProcesses([{
		name: "server",
		command: "node",
		arguments: ["server.mjs"],
		environment: {}
	}], "/repo", {
		processHost,
		spawnProcess() { return child; }
	});

	processHost.emit("SIGTSTP");
	await session;

	assert.deepEqual(processSignals, [{ processId: 0, signal: "SIGCONT" }]);
	assert.deepEqual(childSignals, ["SIGTERM"]);
	assert.equal(processHost.listenerCount("SIGTSTP"), 0);
});

test("an active setup command terminates when the session shutdown signal aborts", async function _AbortSetupCommand()
{
	const shutdownController = new AbortController();
	const shutdownReason = new Error("session stopped");
	const childSignals = [];
	const child = new EventEmitter();
	child.stdin = new PassThrough();
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.kill = function _SignalChild(signal)
	{
		childSignals.push(signal);
		queueMicrotask(function _CloseChild() { child.emit("close", null, signal); });
	};
	const command = runLocalCommand("docker", ["pull", "image"], {
		signal: shutdownController.signal,
		spawnProcess() { return child; }
	});

	shutdownController.abort(shutdownReason);

	await assert.rejects(command, shutdownReason);
	assert.deepEqual(childSignals, ["SIGTERM"]);
});

test("an aborted setup command force-stops descendants after its wrapper closes", async function _AbortSetupTree()
{
	const shutdownController = new AbortController();
	const processHost = new EventEmitter();
	const processSignals = [];
	let groupAlive = true;
	processHost.env = { PATH: "/usr/bin" };
	processHost.platform = "darwin";
	processHost.kill = function _SignalProcessGroup(processId, signal)
	{
		if (signal === 0)
		{
			return;
		}

		processSignals.push({ processId, signal });

		if (signal === "SIGKILL")
		{
			groupAlive = false;
		}
	};
	const child = new EventEmitter();
	child.pid = 411;
	child.stdin = new PassThrough();
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.kill = function _UnexpectedDirectSignal() { throw new Error("setup command must be signalled through its process group"); };
	const command = runLocalCommand("npm", ["run", "db:seed-tier2"], {
		processHost,
		shutdownGraceMilliseconds: 0,
		signal: shutdownController.signal,
		spawnProcess() { return child; }
	});

	shutdownController.abort(new Error("session stopped"));
	queueMicrotask(function _CloseWrapper() { child.emit("close", null, "SIGTERM"); });
	await assert.rejects(command, /session stopped/);

	assert.equal(groupAlive, false);
	assert.deepEqual(processSignals, [
		{ processId: -411, signal: "SIGTERM" },
		{ processId: -411, signal: "SIGKILL" }
	]);
});

test("coordinated processes use isolated groups that one shutdown signal terminates", async function _IsolatedProcessGroup()
{
	const shutdownController = new AbortController();
	const processHost = new EventEmitter();
	const processSignals = [];
	let spawnOptions;
	processHost.env = { PATH: "/usr/bin" };
	processHost.platform = "darwin";
	const child = new EventEmitter();
	child.pid = 321;
	let groupAlive = true;
	child.kill = function _UnexpectedDirectSignal() { throw new Error("isolated child must be signalled through its process group"); };
	processHost.kill = function _SignalProcessGroup(processId, signal)
	{
		if (signal === 0)
		{
			if (!groupAlive)
			{
				const error = new Error("group exited");
				error.code = "ESRCH";
				throw error;
			}

			return;
		}

		processSignals.push({ processId, signal });

		if (signal === "SIGTERM")
		{
			groupAlive = false;
			queueMicrotask(function _CloseChild() { child.emit("close", 0, signal); });
		}
	};
	const session = runDevelopmentProcesses([{
		name: "opencrane-ui",
		command: "npx",
		arguments: ["nx", "serve", "opencrane-ui"],
		environment: {}
	}], "/repo", {
		processHost,
		signal: shutdownController.signal,
		spawnProcess(_command, _arguments, options) { spawnOptions = options; return child; }
	});

	shutdownController.abort();
	await session;

	assert.equal(spawnOptions.detached, true);
	assert.deepEqual(processSignals, [{ processId: -321, signal: "SIGTERM" }]);
});

test("a descendant that outlives its wrapper receives the forced group stop", async function _ForceDescendantStop()
{
	const shutdownController = new AbortController();
	const processHost = new EventEmitter();
	const processSignals = [];
	let groupAlive = true;
	processHost.env = { PATH: "/usr/bin" };
	processHost.platform = "darwin";
	const child = new EventEmitter();
	child.pid = 512;
	child.kill = function _UnexpectedDirectSignal() { throw new Error("isolated child must be signalled through its process group"); };
	processHost.kill = function _SignalProcessGroup(processId, signal)
	{
		if (signal === 0)
		{
			if (!groupAlive)
			{
				const error = new Error("group exited");
				error.code = "ESRCH";
				throw error;
			}

			return;
		}

		processSignals.push({ processId, signal });

		if (signal === "SIGTERM")
		{
			queueMicrotask(function _CloseWrapper() { child.emit("close", 0, signal); });
		}

		if (signal === "SIGKILL")
		{
			groupAlive = false;
		}
	};
	const session = runDevelopmentProcesses([{
		name: "agent-controller",
		command: "npx",
		arguments: ["nx", "run", "agent-controller:dev-tier2"],
		environment: {}
	}], "/repo", {
		processHost,
		shutdownGraceMilliseconds: 0,
		signal: shutdownController.signal,
		spawnProcess() { return child; }
	});

	shutdownController.abort();
	await session;

	assert.equal(groupAlive, false);
	assert.deepEqual(processSignals, [
		{ processId: -512, signal: "SIGTERM" },
		{ processId: -512, signal: "SIGKILL" }
	]);
});

test("an early wrapper failure still terminates descendants in its process group", async function _EarlyWrapperFailure()
{
	const processHost = new EventEmitter();
	const processSignals = [];
	let groupAlive = true;
	processHost.env = { PATH: "/usr/bin" };
	processHost.platform = "darwin";
	const child = new EventEmitter();
	child.pid = 613;
	child.kill = function _UnexpectedDirectSignal() { throw new Error("isolated child must be signalled through its process group"); };
	processHost.kill = function _SignalProcessGroup(processId, signal)
	{
		if (signal === 0)
		{
			if (!groupAlive)
			{
				const error = new Error("group exited");
				error.code = "ESRCH";
				throw error;
			}

			return;
		}

		processSignals.push({ processId, signal });
		groupAlive = false;
	};
	const session = runDevelopmentProcesses([{
		name: "opencrane-ui",
		command: "npx",
		arguments: ["nx", "serve", "opencrane-ui"],
		environment: {}
	}], "/repo", {
		processHost,
		spawnProcess() { return child; }
	});

	child.emit("close", 1, null);
	await assert.rejects(session, /opencrane-ui exited early/);

	assert.equal(groupAlive, false);
	assert.deepEqual(processSignals, [{ processId: -613, signal: "SIGTERM" }]);
});
