import type { RunCancellationRepository } from "@opencrane/backend/agents/execution/runs";

import { _log } from "../app/log";

/** Delay between checks for local runtime processes lost across coordinator restarts. */
const _RUNTIME_REPAIR_INTERVAL_MILLISECONDS = 30_000;

/** Start the database-fenced repair pass used when a local runtime lease expires. */
export function _StartDevelopmentRuntimeRepair(repository: Pick<RunCancellationRepository, "repairNextExpiredRunAtomically">, intervalMilliseconds = _RUNTIME_REPAIR_INTERVAL_MILLISECONDS): { stop(): void }
{
	if (!Number.isSafeInteger(intervalMilliseconds) || intervalMilliseconds < 1_000 || intervalMilliseconds > 300_000)
	{
		throw new Error("Tier 2 runtime repair interval must be between 1 and 300 seconds");
	}

	function _Repair(): void
	{
		void repository.repairNextExpiredRunAtomically().catch(function _RepairFailure(error: unknown): void
		{
			_log.error({ err: error }, "Tier 2 runtime terminal repair failed");
		});
	}

	_Repair();
	const handle = setInterval(_Repair, intervalMilliseconds);
	handle.unref();
	return {
		stop(): void
		{
			clearInterval(handle);
		}
	};
}
