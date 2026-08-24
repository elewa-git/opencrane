import type { IWorkflowTaskQueueAuthority } from "@opencrane/backend/server/infra/workflows/contract";
import type { Pool } from "pg";

/**
 * Configures the Absurd workflow engine for one server process or qualification session.
 *
 * Application composition supplies the same queue authority to the workflow guard and this engine,
 * so a task cannot validate against one queue policy and run on another. Supplying `databasePool`
 * keeps that caller responsible for closing the pool; otherwise the engine creates and closes it.
 */
export interface IAbsurdWorkflowEngineOptions
{
	/** PostgreSQL URL for this silo's existing CNPG database. */
	readonly databaseUrl: string;
	/** Shared SDK pool ceiling across every registered task queue. */
	readonly databasePoolSize: number;
	/** Optional caller-owned pool for a bounded live qualification or composition root. */
	readonly databasePool?: Pool;
	/** Stores the reviewed queue authority that the workflow guard also uses. */
	readonly queueAuthority: IWorkflowTaskQueueAuthority;
	/** Maximum parallel handlers each engine queue may execute. */
	readonly workerConcurrency?: number;
	/** Idle polling interval in milliseconds. */
	readonly pollIntervalMs?: number;
}
