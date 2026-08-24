import { PrismaClient } from "@prisma/client";

import type { IWorkflowTransaction } from "@opencrane/backend/server/infra/workflows/contract";

import type { IWorkflowEngineQualificationUnitOfWork } from "./workflow-engine-qualification-unit-of-work.types";

/** Own the live qualifier's Prisma client and its transaction-bound admission calls. */
export class PrismaWorkflowEngineQualificationUnitOfWork implements IWorkflowEngineQualificationUnitOfWork
{
	/** Qualification-only client tagged and bounded by the supplied database URL. */
	private readonly prisma: PrismaClient;

	/** Create a caller-owned transaction client without exposing the database URL to output. */
	constructor(databaseUrl: string)
	{
		this.prisma = new PrismaClient({ datasourceUrl: databaseUrl });
	}

	/** Run one operation within the exact transaction that commits its task admission. */
	async admit<TResult>(operation: (transaction: IWorkflowTransaction) => Promise<TResult>): Promise<TResult>
	{
		return await this.prisma.$transaction(async function _Admit(transaction)
		{
			return await operation({ client: transaction });
		});
	}

	/** Release the qualification Prisma pool. */
	async close(): Promise<void>
	{
		await this.prisma.$disconnect();
	}
}
