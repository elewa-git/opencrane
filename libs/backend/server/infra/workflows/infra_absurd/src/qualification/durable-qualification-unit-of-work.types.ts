import type { DurableExecutionTransaction } from "@opencrane/backend/server/infra/workflows/contract";

/** Caller-owned transaction boundary used only by the live durable-admission qualification. */
export interface DurableQualificationUnitOfWork
{
	/** Run one admission operation and commit it with the caller-owned Prisma transaction. */
	admit<TResult>(operation: (transaction: DurableExecutionTransaction) => Promise<TResult>): Promise<TResult>;
	/** Release the qualification client's bounded connection pool. */
	close(): Promise<void>;
}
