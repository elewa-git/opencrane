import type { Logger } from "@opencrane/backend/observability";

import type { DevelopmentServerHandle } from "./composition.types";

/** Runs ordered cleanup stages, completing every action while retaining every failure. */
export async function _RunDevelopmentCleanup(stages: ReadonlyArray<ReadonlyArray<() => Promise<unknown>>>, message: string): Promise<void>
{
	const failures: unknown[] = [];
	for (const stage of stages)
	{
		const results = await Promise.allSettled(stage.map(async function _Run(action): Promise<unknown> { return action(); }));
		for (const result of results)
		{
			if (result.status === "rejected")
			{
				failures.push(result.reason);
			}
		}
	}
	if (failures.length > 0)
	{
		throw new AggregateError(failures, message);
	}
}

/** Preserves a primary failure while reporting any failures raised during its cleanup. */
export async function _RethrowAfterDevelopmentCleanup(primaryFailure: unknown, stages: ReadonlyArray<ReadonlyArray<() => Promise<unknown>>>, message: string): Promise<never>
{
	try
	{
		await _RunDevelopmentCleanup(stages, message);
	}
	catch (cleanupFailure)
	{
		throw new AggregateError([primaryFailure, cleanupFailure], `${message} after an earlier failure`);
	}
	throw primaryFailure;
}

/** Bind idempotent signal cleanup and report any failure after all process resources are drained. */
export function _BindDevelopmentSignalCleanup(handle: DevelopmentServerHandle, shutdownTelemetry: () => Promise<void>, unbindConsole: () => void, processHost: Pick<NodeJS.Process, "exitCode" | "on">, logger: Pick<Logger, "error" | "info">): void
{
	let stopping: Promise<void> | null = null;
	function _Stop(signal: NodeJS.Signals): void
	{
		if (stopping !== null)
		{
			return;
		}
		logger.info({ signal }, "Tier 2 product server stopping");
		stopping = _RunDevelopmentCleanup([
			[handle.stop],
			[shutdownTelemetry],
			[async function _UnbindConsole(): Promise<void> { unbindConsole(); }],
		], "Tier 2 process cleanup failed");
		void stopping.catch(function _ReportCleanupFailure(error: unknown): void
		{
			logger.error({ err: error, signal }, "Tier 2 product server cleanup failed");
			processHost.exitCode = 1;
		});
	}
	processHost.on("SIGINT", function _Interrupt(): void { _Stop("SIGINT"); });
	processHost.on("SIGTERM", function _Terminate(): void { _Stop("SIGTERM"); });
}
