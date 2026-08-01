/** Atomic persona-owned transaction seam for lifecycle steps that do not change configuration state. */
export interface PersonaPersistenceUnitOfWork
{
	/** Runs one persona lifecycle operation against one transaction-scoped Prisma client. */
	run<Result>(work: (transaction: unknown) => Promise<Result>): Promise<Result>;
}
