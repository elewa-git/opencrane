import type { DurableTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

/**
 * Identifies one temporary Gate D2 task without persisting database or Kubernetes credentials.
 * The silo check prevents a task from satisfying a run created for another tenant.
 */
export interface _DurableExecutionQualificationInput
{
	/** Zero-based task number used to resolve the matching local latency sample. */
	readonly sampleIndex: number;
	/** Silo that the live deploy wrapper selected for this qualification. */
	readonly siloId: string;
}

/** Construction inputs that bind one session to its unique queue and connection identity. */
export interface _DurableExecutionQualificationSessionOptions
{
	/** PostgreSQL application name used to count only this session's connections. */
	readonly applicationName: string;
	/** Maximum connections available to the shared Absurd SDK pool. */
	readonly databasePoolSize: number;
	/** Application-role URL for the selected silo PgBouncer endpoint. */
	readonly databaseUrl: string;
	/** Idle interval used by the worker under qualification. */
	readonly pollIntervalMs: number;
	/** Temporary Absurd queue reserved for this run. */
	readonly queueName: string;
	/** Random run identity used to isolate queue, worker, and idempotency keys. */
	readonly runId: string;
	/** Silo that every temporary qualification task must identify. */
	readonly siloId: string;
}

/**
 * Owns the temporary queue, worker, transactions, and database connections for one live run.
 *
 * The runner sees this narrow lifecycle instead of constructing SDK and Prisma resources itself,
 * so tests can prove admission and cleanup behavior without opening a database connection.
 */
export interface _DurableExecutionQualificationSession
{
	/** Create the unique queue and start its worker before any sample is admitted. */
	start(onStarted: (input: _DurableExecutionQualificationInput) => void): Promise<void>;
	/** Admit one sample through the caller-owned Prisma transaction. */
	admit(input: _DurableExecutionQualificationInput): Promise<DurableTaskReceipt>;
	/** Count this qualification's application-role connections, or report unavailable evidence. */
	connectionCount(): Promise<number | null>;
	/** Drain work, remove the temporary queue, and release every owned resource. */
	close(): Promise<void>;
}
