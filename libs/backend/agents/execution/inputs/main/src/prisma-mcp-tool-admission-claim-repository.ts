import type { Prisma } from "@prisma/client";

import type { McpToolAdmissionClaimRepository } from "./session-assembly.types";

/** Stores the typed claim that serializes MCP policy reads for one agent revision. */
export class PrismaMcpToolAdmissionClaimRepository implements McpToolAdmissionClaimRepository
{
	/** Transaction shared with the complete run-admission snapshot build. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Bind claim writes to the caller's serializable run-admission transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/** Touch one stable claim so competing admissions for the same revision serialize. */
	async touch(agentRevisionId: string, siloId: string, admittedAt: Date): Promise<void>
	{
		await this._transaction.mcpToolAdmissionClaim.upsert({
			where: { agentRevisionId_siloId: { agentRevisionId, siloId } },
			create: { agentRevisionId, siloId, touchedAt: admittedAt },
			update: { touchedAt: admittedAt },
		});
	}
}
