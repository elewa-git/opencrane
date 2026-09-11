import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { HostConversationComputerChild, HostConversationComputerProcessReservation } from "./host-conversation-computer-process.types";

/** Waits this long for a child to report that its executable started. */
const _STARTUP_TIMEOUT_MILLISECONDS = 5_000;

/** Derives the same non-secret process identifier for every retry of one lease generation. */
export function _HostConversationComputerProcessId(command: HostConversationComputerProcessReservation): string
{
	const digest = createHash("sha256").update(`${command.siloId}\u0000${command.computerId}\u0000${command.leaseId}\u0000${command.generation}`, "utf8").digest("hex").slice(0, 32);
	return `local-computer-${digest}`;
}

/** Hashes one bearer before the server retains it. */
export function _HostConversationComputerBearerDigest(bearer: string): Buffer
{
	return createHash("sha256").update(bearer, "utf8").digest();
}

/** Keeps environment values needed to locate executables and load the Python standard library. */
export function _HostConversationComputerChildEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv
{
	const environment: NodeJS.ProcessEnv = {};
	for (const name of ["HOME", "LANG", "LC_ALL", "PATH", "PYTHONHOME", "SYSTEMROOT", "TMPDIR"])
	{
		if (source[name] !== undefined)
		{
			environment[name] = source[name];
		}
	}
	return environment;
}

/** Resolves after a timeout without retaining a referenced timer. */
export function _HostConversationComputerDelay(milliseconds: number): Promise<void>
{
	return new Promise<void>(function _Waiting(resolve): void
	{
		const timer = setTimeout(resolve, milliseconds);
		timer.unref();
	});
}

/** Waits until the child writes its process marker or terminates first. */
export function _WaitForHostConversationComputerReadiness(child: HostConversationComputerChild, path: string, processId: string): Promise<void>
{
	return new Promise<void>(function _Waiting(resolve, reject): void
	{
		let finished = false;
		let pollTimer: NodeJS.Timeout | null = null;
		const timeout = setTimeout(function _TimedOut(): void { _Finish(new Error("Host conversation computer did not become ready")); }, _STARTUP_TIMEOUT_MILLISECONDS);
		timeout.unref();

		/** Removes timers and listeners retained by this readiness attempt. */
		function _Cleanup(): void
		{
			clearTimeout(timeout);
			if (pollTimer !== null)
			{
				clearTimeout(pollTimer);
			}
			child.removeListener("error", _Errored);
			child.removeListener("close", _Closed);
		}

		/** Settles the readiness attempt once. */
		function _Finish(error?: Error): void
		{
			if (finished)
			{
				return;
			}
			finished = true;
			_Cleanup();
			if (error)
			{
				reject(error);
			}
			else
			{
				resolve();
			}
		}

		/** Rejects readiness when the child cannot start. */
		function _Errored(error: Error): void
		{
			_Finish(error);
		}

		/** Rejects readiness when the child exits before writing its marker. */
		function _Closed(code: number | null, signal: NodeJS.Signals | null): void
		{
			_Finish(new Error(`Host conversation computer exited during startup (${signal ?? `exit ${code}`})`));
		}

		/** Polls the private marker because the Python child writes it after validating its configuration. */
		async function _Poll(): Promise<void>
		{
			try
			{
				const marker = await readFile(path, "utf8");
				if (marker === processId)
				{
					_Finish();
					return;
				}
			}
			catch (error)
			{
				if ((error as NodeJS.ErrnoException).code !== "ENOENT")
				{
					_Finish(error as Error);
					return;
				}
			}
			if (!finished)
			{
				pollTimer = setTimeout(function _PollAgain(): void { void _Poll(); }, 20);
				pollTimer.unref();
			}
		}

		child.once("error", _Errored);
		child.once("close", _Closed);
		void _Poll();
	});
}
