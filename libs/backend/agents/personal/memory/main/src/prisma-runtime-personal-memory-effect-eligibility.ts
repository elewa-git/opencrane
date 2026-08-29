import { AuthorizationBoundaryKind, MemoryDatasetState, type Prisma } from "@prisma/client";

import type { RuntimePersonalMemoryEffectEligibility, RuntimePersonalMemoryEffectEligibilityCommand } from "./runtime-personal-memory-effect-eligibility.types";

/** Reads the current personal-memory dataset on the runtime effect transaction. */
export class PrismaRuntimePersonalMemoryEffectEligibilityAuthority implements RuntimePersonalMemoryEffectEligibility
{
	/** Transaction shared with the ToolInvocation admission. */
	private readonly transaction: Prisma.TransactionClient;

	/**
	 * Binds personal-memory lifecycle reads to the caller's open transaction.
	 *
	 * Called by: the OpenCrane runtime composition when it builds external-effect admission.
	 * @param transaction - Transaction that will also persist the admitted ToolInvocation.
	 */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** @inheritdoc */
	async isEligible(command: RuntimePersonalMemoryEffectEligibilityCommand): Promise<boolean>
	{
		const dataset = await this.transaction.memoryDataset.findFirst({
			where: {
				id: command.datasetId,
				siloId: command.siloId,
				state: MemoryDatasetState.Active,
				boundaryKind: AuthorizationBoundaryKind.Personal,
				boundaryPrincipalId: command.principalId,
				boundaryGroupId: null,
			},
			select: { id: true },
		});
		return dataset !== null;
	}
}
