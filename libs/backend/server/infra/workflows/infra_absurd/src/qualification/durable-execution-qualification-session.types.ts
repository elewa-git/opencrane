import type { DurableTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

/**
 * Identifies one temporary Gate D2 task without persisting database or Kubernetes credentials.
 *
 * The silo check prevents a task from satisfying a run created for another tenant.
 */
export interface IQualificationTaskInput
{
	/** Zero-based task number used to resolve the matching local latency sample. */
	readonly sampleIndex: number;
	/** Silo that the live deploy wrapper selected for this qualification. */
	readonly siloId: string;
}

/** Builds the unique queue and connection identity for one qualification session. */
export interface IQualificationWorkflowSessionOptions
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
 * Defines the resource-owning lifecycle for one live qualification run.
 *
 * The runner calls {@link start}, repeats {@link next} and {@link connectionCount}, then calls
 * {@link close} even when a sample fails. The session owns the temporary queue, worker, database
 * clients, and qualification {@link DurableQualificationUnitOfWork}; that UnitOfWork, rather than
 * `next`, owns the database transaction which commits a task receipt. Keeping the runner behind
 * this interface lets its tests prove that lifecycle without opening a database connection.
 */
export interface IQualificationWorkflowSession
{
	/** Starts the unique queue and worker before the runner submits a sample. */
	start(onStarted: (input: IQualificationTaskInput) => void): Promise<void>;
	/** Submits the next sample through the session's qualification UnitOfWork transaction. */
	next(input: IQualificationTaskInput): Promise<DurableTaskReceipt>;
	/** Counts this qualification's application-role connections, or reports unavailable evidence. */
	connectionCount(): Promise<number | null>;
	/** Drains work, removes the temporary queue, and releases every resource this session owns. */
	close(): Promise<void>;
}
