import type { DurableTaskQueueAuthority } from "@opencrane/backend/server/infra/workflows/contract";

/** Configuration for the Absurd adapter's engine-owned connections and queues. */
export interface AbsurdDurableExecutionOptions
{
	/** PostgreSQL URL for this silo's existing CNPG database. */
	readonly databaseUrl: string;
	/** Immutable reviewed queue authority shared with the workflow kit. */
	readonly queueAuthority: DurableTaskQueueAuthority;
	/** Maximum parallel handlers each engine queue may execute. */
	readonly workerConcurrency?: number;
	/** Idle polling interval in milliseconds. */
	readonly pollIntervalMs?: number;
}
