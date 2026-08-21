import type { DurableTaskReceipt, DurableTaskStates } from "@opencrane/backend/server/infra/workflows/contract";

/** Deterministic task projection exposed by the engine-free contract test double. */
export interface FakeDurableTaskSnapshot
{
	/** Stable task reference. */
	readonly receipt: DurableTaskReceipt;
	/** Current state produced by the test double. */
	readonly state: DurableTaskStates;
	/** Handler result after the task completes, when it produced one. */
	readonly result: unknown;
	/** Handler failure after the task fails, when it threw one. */
	readonly error: unknown;
}
