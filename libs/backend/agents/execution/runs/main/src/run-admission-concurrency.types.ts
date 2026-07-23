/** Bounded per-service concurrency and queue policy applied before admission opens a database transaction. */
export interface RunAdmissionConcurrencyPolicy
{
	/** Maximum active admissions for one `(siloId, agentServiceId)` key. */
	readonly maxConcurrentAdmissions: number;
	/** Maximum waiting admissions for the same key; later requests are rejected without a database connection. */
	readonly maxQueuedAdmissions: number;
}

/** Outcome returned after a caller either receives a bounded admission slot or is rejected before persistence begins. */
export type RunAdmissionConcurrencyResult<TResult> = { readonly outcome: "completed"; readonly value: TResult } | { readonly outcome: "rejected"; readonly reason: "admission_concurrency_limited" };
