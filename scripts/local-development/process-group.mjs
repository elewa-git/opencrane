/**
 * Sends a signal to a coordinator-owned process tree.
 *
 * Setup and application commands start as POSIX process-group leaders because npm or Nx can close
 * before a descendant does. A negative PID reaches the wrapper and its descendants together.
 * Windows uses the direct child because Node does not expose POSIX process groups there.
 *
 * @param {{ readonly pid?: number, kill(signal: NodeJS.Signals): boolean }} child - Direct child returned by Node spawn.
 * @param {NodeJS.Signals | 0} signal - Signal or existence probe sent to the process tree.
 * @param {typeof process} processHost - Process API used for platform checks and group signalling.
 * @returns {void}
 * @throws When process signalling fails for a reason other than an already-finished process group.
 */
export function _SignalDevelopmentProcessTree(child, signal, processHost = process)
{
	if (processHost.platform !== "win32" && Number.isSafeInteger(child.pid))
	{
		try
		{
			processHost.kill(-child.pid, signal);
		}
		catch (error)
		{
			if (error?.code !== "ESRCH")
			{
				throw error;
			}
		}

		return;
	}

	if (signal !== 0)
	{
		child.kill(signal);
	}
}

/**
 * Checks whether a POSIX process group can still receive a signal.
 * The command runner and supervisor call this after a wrapper closes so container cleanup does not
 * start while one of its descendants remains. Windows uses the direct child's close event because
 * Node does not expose a process-group probe there.
 *
 * @param {{ readonly pid?: number }} child - Direct child whose PID also identifies its POSIX group.
 * @param {typeof process} processHost - Process API used for platform checks and group probing.
 * @returns {boolean} True while a POSIX group can still receive a signal; false on Windows.
 * @throws When the probe fails for a reason other than an absent process group.
 */
export function _DevelopmentProcessTreeIsRunning(child, processHost = process)
{
	if (processHost.platform === "win32" || !Number.isSafeInteger(child.pid))
	{
		return false;
	}

	try
	{
		processHost.kill(-child.pid, 0);
		return true;
	}
	catch (error)
	{
		if (error?.code === "ESRCH")
		{
			return false;
		}

		if (error?.code === "EPERM")
		{
			return true;
		}

		throw error;
	}
}
