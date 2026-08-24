import fs from "node:fs";
import path from "node:path";

function _isRunningProcess(processId)
{
	try
	{
		process.kill(processId, 0);
		return true;
	}
	catch (error)
	{
		return error?.code === "EPERM";
	}
}

/**
 * Acquires the repository-scoped Tier 2 lock or replaces a lock whose process no longer exists.
 * @returns {{ lockPath: string, processId: number }} Ownership evidence required for release.
 * @throws When another live coordinator owns the lock.
 */
export function acquireLocalDevelopmentLock(repositoryRoot, processId = process.pid)
{
	const lockPath = path.join(repositoryRoot, "keys/.tier2-local-development.lock");
	fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });

	for (let attempt = 0; attempt < 2; attempt += 1)
	{
		try
		{
			fs.writeFileSync(lockPath, `${processId}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
			return {
				lockPath,
				processId
			};
		}
		catch (error)
		{
			if (error?.code !== "EEXIST")
			{
				throw error;
			}

			const owner = Number(fs.readFileSync(lockPath, "utf8").trim());

			if (Number.isSafeInteger(owner) && owner > 0 && _isRunningProcess(owner))
			{
				throw new Error(`Tier 2 local development is already running as process ${owner}`);
			}

			fs.unlinkSync(lockPath);
		}
	}

	throw new Error("Could not acquire the Tier 2 local-development lock");
}

/** Releases the Tier 2 lock only while its file still names this coordinator process. */
export function releaseLocalDevelopmentLock(lock)
{
	let owner;

	try
	{
		owner = Number(fs.readFileSync(lock.lockPath, "utf8").trim());
	}
	catch (error)
	{
		if (error?.code === "ENOENT")
		{
			return;
		}

		throw error;
	}

	if (owner === lock.processId)
	{
		fs.unlinkSync(lock.lockPath);
	}
}
