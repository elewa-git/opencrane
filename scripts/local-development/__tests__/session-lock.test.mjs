import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { acquireLocalDevelopmentSessionLock } from "../session-lock.mjs";

/** Creates an isolated lock path removed with its temporary directory. */
function _Fixture()
{
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrane-tier2-lock-"));

	return { directory, lockPath: path.join(directory, "session.lock") };
}

test("one worktree session excludes another process until release", function _ExclusiveSession()
{
	const fixture = _Fixture();

	try
	{
		const owner = acquireLocalDevelopmentSessionLock(fixture.lockPath);
		const blocked = acquireLocalDevelopmentSessionLock(fixture.lockPath);
		assert.equal(owner.acquired, true);
		assert.equal(blocked.acquired, false);
		assert.equal(blocked.ownerPid, process.pid);

		owner.release();
		const replacement = acquireLocalDevelopmentSessionLock(fixture.lockPath);
		assert.equal(replacement.acquired, true);
		replacement.release();
	}
	finally
	{
		fs.rmSync(fixture.directory, { force: true, recursive: true });
	}
});

test("a dead process lock is reclaimed without removing a new owner", function _StaleSession()
{
	const fixture = _Fixture();
	const staleOwner = {
		pid: 99_999_999,
		processStartedAt: Date.parse("2026-01-01T00:00:00.000Z") / 1_000,
		token: "stale-owner"
	};
	fs.writeFileSync(fixture.lockPath, `${JSON.stringify(staleOwner)}\n`, { mode: 0o600 });

	try
	{
		const owner = acquireLocalDevelopmentSessionLock(fixture.lockPath);
		assert.equal(owner.acquired, true);
		owner.release();
		assert.equal(fs.existsSync(fixture.lockPath), false);
	}
	finally
	{
		fs.rmSync(fixture.directory, { force: true, recursive: true });
	}
});

test("a reused process identifier does not preserve an unrelated stale lock", function _ReusedPid()
{
	const fixture = _Fixture();
	const staleOwner = {
		pid: process.pid,
		processStartedAt: Date.parse("2000-01-01T00:00:00.000Z") / 1_000,
		token: "stale-owner"
	};
	fs.writeFileSync(fixture.lockPath, `${JSON.stringify(staleOwner)}\n`, { mode: 0o600 });

	try
	{
		const owner = acquireLocalDevelopmentSessionLock(fixture.lockPath);
		assert.equal(owner.acquired, true);
		owner.release();
		assert.equal(fs.existsSync(fixture.lockPath), false);
	}
	finally
	{
		fs.rmSync(fixture.directory, { force: true, recursive: true });
	}
});

test("an obsolete owner cannot release a replacement lock", function _TokenCheckedRelease()
{
	const fixture = _Fixture();

	try
	{
		const obsoleteOwner = acquireLocalDevelopmentSessionLock(fixture.lockPath);
		assert.equal(obsoleteOwner.acquired, true);
		fs.unlinkSync(fixture.lockPath);
		const replacement = acquireLocalDevelopmentSessionLock(fixture.lockPath);
		assert.equal(replacement.acquired, true);

		obsoleteOwner.release();
		assert.equal(fs.existsSync(fixture.lockPath), true);
		replacement.release();
		assert.equal(fs.existsSync(fixture.lockPath), false);
	}
	finally
	{
		fs.rmSync(fixture.directory, { force: true, recursive: true });
	}
});

test("Windows validates a live owner through PowerShell", function _WindowsOwner()
{
	const fixture = _Fixture();
	const ownerStartedAt = Date.parse("2026-09-16T08:00:00.000Z") / 1_000;
	const recordedOwner = {
		pid: 4_242,
		processStartedAt: ownerStartedAt,
		token: "active-owner"
	};
	const processHost = {
		pid: 8_484,
		platform: "win32",
		kill: function _LiveProcess() {}
	};
	fs.writeFileSync(fixture.lockPath, `${JSON.stringify(recordedOwner)}\n`, { mode: 0o600 });

	function _PowerShell(command, argumentsList)
	{
		assert.equal(command, "powershell.exe");
		assert.equal(argumentsList.includes("-NonInteractive"), true);
		assert.match(argumentsList.at(-1), /Get-Process -Id 4242/u);

		return {
			status: 0,
			stdout: "2026-09-16T08:00:00.0000000Z\n"
		};
	}

	try
	{
		const blocked = acquireLocalDevelopmentSessionLock(fixture.lockPath, {
			currentProcessStartedAt: ownerStartedAt + 100,
			processHost,
			spawnProcess: _PowerShell
		});
		assert.equal(blocked.acquired, false);
		assert.equal(blocked.ownerPid, recordedOwner.pid);
	}
	finally
	{
		fs.rmSync(fixture.directory, { force: true, recursive: true });
	}
});
