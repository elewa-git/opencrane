import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireLocalDevelopmentLock, releaseLocalDevelopmentLock } from "../local-development/lock.mjs";

test("the coordinator lock refuses a second live owner and releases only its own file", function _exclusiveLock(t)
{
	const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencrane-local-lock-"));
	t.after(function _cleanup() { fs.rmSync(repositoryRoot, { recursive: true, force: true }); });
	const lock = acquireLocalDevelopmentLock(repositoryRoot);

	assert.equal(fs.statSync(lock.lockPath).mode & 0o777, 0o600);
	assert.throws(function _secondOwner() { acquireLocalDevelopmentLock(repositoryRoot); }, /already running/);
	releaseLocalDevelopmentLock(lock);
	assert.equal(fs.existsSync(lock.lockPath), false);
});

test("the coordinator replaces a stale lock", function _staleLock(t)
{
	const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencrane-local-lock-"));
	t.after(function _cleanup() { fs.rmSync(repositoryRoot, { recursive: true, force: true }); });
	const keysDirectory = path.join(repositoryRoot, "keys");
	fs.mkdirSync(keysDirectory);
	const lockPath = path.join(keysDirectory, ".tier2-local-development.lock");
	fs.writeFileSync(lockPath, "999999999\n", { mode: 0o600 });
	const lock = acquireLocalDevelopmentLock(repositoryRoot);

	assert.equal(Number(fs.readFileSync(lockPath, "utf8").trim()), process.pid);
	releaseLocalDevelopmentLock(lock);
});
