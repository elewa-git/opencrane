import type { IWorkflowTransaction } from "@opencrane/backend/server/infra/workflows/contract";

/** Caller-owned transaction boundary used only by the live workflow-engine qualification. */
export interface IWorkflowEngineQualificationUnitOfWork
{
	/** Run one admission operation and commit it with the caller-owned Prisma transaction. */
	admit<TResult>(operation: (transaction: IWorkflowTransaction) => Promise<TResult>): Promise<TResult>;
	/** Release the qualification client's bounded connection pool. */
	close(): Promise<void>;
}
