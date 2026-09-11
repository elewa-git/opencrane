/** Signals a POSIX process group or a single Windows child. */
export function _SignalDevelopmentProcessTree(child, signal, processHost = process)
{
	if (!child.pid)
	{
		return;
	}

	try
	{
		if (processHost.platform === "win32")
		{
			child.kill(signal);
		}
		else
		{
			processHost.kill(-child.pid, signal);
		}
	}
	catch (error)
	{
		if (error?.code !== "ESRCH")
		{
			throw error;
		}
	}
}
