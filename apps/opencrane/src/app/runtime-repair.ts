import type { RunCancellationRepository } from "@opencrane/backend/agents/execution/runs";

import { _log } from "./log";

/** Delay between checks for a runtime attempt whose signed workload lease expired. */
const _RUNTIME_REPAIR_INTERVAL_MILLISECONDS = 30_000;

/** Start the shared database-fenced repair pass for expired runtime attempts. */
export function _StartRuntimeRepair(repository: Pick<RunCancellationRepository, "repairNextExpiredRunAtomically">, runImmediately = false, intervalMilliseconds = _RUNTIME_REPAIR_INTERVAL_MILLISECONDS): { stop(): void }
{
	if (!Number.isSafeInteger(intervalMilliseconds) || intervalMilliseconds < 1_000 || intervalMilliseconds > 300_000)
	{
		throw new Error("runtime repair interval must be between 1 and 300 seconds");
	}

	function _Repair(): void
	{
		void repository.repairNextExpiredRunAtomically().catch(function _RepairFailure(error: unknown): void
		{
			_log.error({ err: error }, "runtime terminal repair failed");
		});
	}

	if (runImmediately)
	{
		_Repair();
	}

	const handle = setInterval(_Repair, intervalMilliseconds);
	handle.unref();
	return {
		stop(): void
		{
			clearInterval(handle);
		}
	};
}
