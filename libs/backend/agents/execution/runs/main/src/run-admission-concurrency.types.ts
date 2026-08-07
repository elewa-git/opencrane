/** Bounded per-service concurrency and queue policy applied before admission opens a database transaction. */
export interface RunAdmissionConcurrencyPolicy
{
	/** Maximum active admissions for one `(siloId, agentServiceId)` key. */
	readonly maxConcurrentAdmissions: number;
	/** Maximum waiting admissions for the same key; later requests are rejected without a database connection. */
	readonly maxQueuedAdmissions: number;
}

/** Stable overload reason returned before admission can acquire a database connection. */
export enum RunAdmissionConcurrencyDenialReasons
{
	/** The global, silo, or service queue reached its configured waiting limit. */
	AdmissionConcurrencyLimited = "admission_concurrency_limited",
}

/** Stable capacity-gate outcomes shared by managed and personal admission control flow. */
export enum RunAdmissionConcurrencyOutcomes
{
	/** The caller obtained capacity and its bounded work completed. */
	Completed = "completed",
	/** The caller was refused before persistence work began. */
	Rejected = "rejected",
}

/** Outcome returned after a caller either receives a bounded admission slot or is rejected before persistence begins. */
export type RunAdmissionConcurrencyResult<TResult> = { readonly outcome: "completed"; readonly value: TResult } | { readonly outcome: "rejected"; readonly reason: RunAdmissionConcurrencyDenialReasons.AdmissionConcurrencyLimited };
