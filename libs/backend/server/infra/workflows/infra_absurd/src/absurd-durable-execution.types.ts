import type { DurableTaskQueueAuthority } from "@opencrane/backend/server/infra/workflows/contract";
import type { Pool } from "pg";

/** Configuration for the Absurd adapter's engine-owned connections and queues. */
export interface AbsurdDurableExecutionOptions
{
	/** PostgreSQL URL for this silo's existing CNPG database. */
	readonly databaseUrl: string;
	/** Shared SDK pool ceiling across every registered task queue. */
	readonly databasePoolSize: number;
	/** Optional caller-owned pool for a bounded live qualification or composition root. */
	readonly databasePool?: Pool;
	/** Immutable reviewed queue authority shared with the workflow kit. */
	readonly queueAuthority: DurableTaskQueueAuthority;
	/** Maximum parallel handlers each engine queue may execute. */
	readonly workerConcurrency?: number;
	/** Idle polling interval in milliseconds. */
	readonly pollIntervalMs?: number;
}
