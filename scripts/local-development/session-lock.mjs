import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Grace period that treats an incomplete lock write as an active startup. */
const _INCOMPLETE_LOCK_GRACE_MILLISECONDS = 2_000;
/** Captures this process instance at the one-second precision available from portable process tools. */
const _CURRENT_PROCESS_STARTED_AT = Math.floor((Date.now() - process.uptime() * 1_000) / 1_000);

/** Reads one lock owner without turning a concurrent removal into a failure. */
function _readOwner(lockPath, fileSystem)
{
	try
	{
		const raw = fileSystem.readFileSync(lockPath, "utf8");
		const modifiedAt = fileSystem.statSync(lockPath).mtimeMs;

		try
		{
			const parsed = JSON.parse(raw);
			const valid = (
				Number.isInteger(parsed.pid)
				&& parsed.pid > 0
				&& Number.isFinite(parsed.processStartedAt)
				&& typeof parsed.token === "string"
			);

			if (!valid)
				return { modifiedAt, raw };

			const owner = {
				modifiedAt,
				ownerPid: parsed.pid,
				ownerProcessStartedAt: parsed.processStartedAt,
				ownerToken: parsed.token,
				raw
			};

			return owner;
		}
		catch
		{
			return { modifiedAt, raw };
		}
	}
	catch (error)
	{
		if (error.code === "ENOENT")
			return;

		throw error;
	}
}

/** Reads the stable start time for one live process instance. */
function _readProcessStartedAt(ownerPid, processHost, currentProcessStartedAt, spawnProcess)
{
	if (ownerPid === processHost.pid)
		return currentProcessStartedAt;

	const command = processHost.platform === "win32" ? "powershell.exe" : "ps";
	const argumentsList = processHost.platform === "win32"
		? [
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			`(Get-Process -Id ${ownerPid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`
		]
		: ["-o", "lstart=", "-p", String(ownerPid)];
	const spawnOptions = processHost.platform === "win32"
		? { encoding: "utf8" }
		: {
			encoding: "utf8",
			env: { ...processHost.env, LC_ALL: "C" }
		};
	const result = spawnProcess(command, argumentsList, spawnOptions);

	if (result.error)
		throw result.error;

	if (result.status !== 0)
		return;

	const startedAt = Date.parse(result.stdout.trim());

	if (Number.isNaN(startedAt))
		throw new Error(`Tier 2 could not read the start time for process ${ownerPid}`);

	return Math.floor(startedAt / 1_000);
}

/** Treats permission-denied probes as live owners and missing processes as stale owners. */
function _isProcessAlive(ownerPid, processHost)
{
	if (!ownerPid)
		return false;

	try
	{
		processHost.kill(ownerPid, 0);
		return true;
	}
	catch (error)
	{
		return error.code !== "ESRCH";
	}
}

/** Returns whether an observed lock still belongs to a live or just-starting process. */
function _isActiveOwner(owner, processHost, readProcessStartedAt, now)
{
	if (!owner)
		return false;

	if (_isProcessAlive(owner.ownerPid, processHost))
	{
		const liveStartedAt = readProcessStartedAt(owner.ownerPid);

		return liveStartedAt === owner.ownerProcessStartedAt;
	}

	return !owner.ownerPid && now() - owner.modifiedAt < _INCOMPLETE_LOCK_GRACE_MILLISECONDS;
}

/** Serializes stale-lock removal so two simultaneous recoveries cannot delete a new owner. */
function _reclaimStaleLock(lockPath, observedOwner, fileSystem, processHost, readProcessStartedAt, now)
{
	const reclaimPath = `${lockPath}.reclaim`;

	try
	{
		fileSystem.mkdirSync(reclaimPath, { mode: 0o700 });
	}
	catch (error)
	{
		if (error.code === "EEXIST")
			return false;

		throw error;
	}

	try
	{
		const currentOwner = _readOwner(lockPath, fileSystem);

		if (!currentOwner)
			return true;

		if (
			currentOwner.raw !== observedOwner.raw
			|| _isActiveOwner(currentOwner, processHost, readProcessStartedAt, now)
		)
		{
			return false;
		}

		fileSystem.unlinkSync(lockPath);
		return true;
	}
	finally
	{
		fileSystem.rmdirSync(reclaimPath);
	}
}

/** Creates the result returned when another Tier 2 process owns the worktree. */
function _blockedResult(ownerPid)
{
	return { acquired: false, ownerPid };
}

/** Acquires one process-owned lock before a Tier 2 session can touch shared resources. */
export function acquireLocalDevelopmentSessionLock(lockPath, options = {})
{
	const fileSystem = options.fileSystem ?? fs;
	const processHost = options.processHost ?? process;
	const now = options.now ?? Date.now;
	const randomUUID = options.randomUUID ?? crypto.randomUUID;
	const spawnProcess = options.spawnProcess ?? childProcess.spawnSync;
	const currentProcessStartedAt = options.currentProcessStartedAt ?? _CURRENT_PROCESS_STARTED_AT;
	const readProcessStartedAt = options.readProcessStartedAt
		?? function _ReadProcessStartedAt(ownerPid)
		{
			return _readProcessStartedAt(
				ownerPid,
				processHost,
				currentProcessStartedAt,
				spawnProcess
			);
		};

	const writeOptions = {
		encoding: "utf8",
		flag: "wx",
		mode: 0o600
	};
	fileSystem.mkdirSync(path.dirname(lockPath), { mode: 0o700, recursive: true });

	for (let attempt = 0; attempt < 3; attempt += 1)
	{
		const owner = {
			pid: processHost.pid,
			processStartedAt: currentProcessStartedAt,
			token: randomUUID()
		};

		try
		{
			fileSystem.writeFileSync(lockPath, `${JSON.stringify(owner)}\n`, writeOptions);

			/** Releases only the lock created by this acquisition. */
			function _release()
			{
				const currentOwner = _readOwner(lockPath, fileSystem);

				if (currentOwner?.ownerToken !== owner.token)
					return;

				fileSystem.unlinkSync(lockPath);
			}

			return { acquired: true, release: _release };
		}
		catch (error)
		{
			if (error.code !== "EEXIST")
				throw error;
		}

		const currentOwner = _readOwner(lockPath, fileSystem);

		if (_isActiveOwner(currentOwner, processHost, readProcessStartedAt, now))
			return _blockedResult(currentOwner?.ownerPid);

		if (
			currentOwner
			&& !_reclaimStaleLock(
				lockPath,
				currentOwner,
				fileSystem,
				processHost,
				readProcessStartedAt,
				now
			)
		)
		{
			return _blockedResult(currentOwner.ownerPid);
		}
	}

	return _blockedResult(undefined);
}
