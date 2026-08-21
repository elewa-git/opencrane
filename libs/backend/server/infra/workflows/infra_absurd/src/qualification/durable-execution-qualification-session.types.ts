import type { DurableTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

/** Input persisted by one temporary Gate D2 task. */
export interface _DurableExecutionQualificationInput
{
	readonly sampleIndex: number;
	readonly siloId: string;
}

/** Construction inputs that bind one session to its unique queue and connection identity. */
export interface _DurableExecutionQualificationSessionOptions
{
	readonly applicationName: string;
	readonly databasePoolSize: number;
	readonly databaseUrl: string;
	readonly pollIntervalMs: number;
	readonly queueName: string;
	readonly runId: string;
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
