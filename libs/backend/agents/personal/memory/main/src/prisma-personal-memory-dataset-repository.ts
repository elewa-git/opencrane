import { AuthorizationScopeKind, GrantSubjectType, MemoryDatasetState, type PrismaClient } from "@prisma/client";

import type { PersonalMemoryDataset, PersonalMemoryDatasetRepository, ResolvePersonalMemoryDatasetCommand } from "./personal-memory-dataset.types.js";

/** Prisma authority that resolves only an active personal dataset under proof-bound identity coordinates. */
export class PrismaPersonalMemoryDatasetRepository implements PersonalMemoryDatasetRepository
{
	/** Canonical per-silo product database. */
	private readonly prisma: PrismaClient;

	/** Creates the repository over the canonical product database. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Returns the one active personal dataset matching the exact signed identity tuple. */
	async findActivePersonalDataset(command: ResolvePersonalMemoryDatasetCommand): Promise<PersonalMemoryDataset | null>
	{
		const dataset = await this.prisma.memoryDataset.findFirst({
			where: {
				siloId: command.siloId,
				organizationId: command.organizationId,
				scopeKind: AuthorizationScopeKind.Personal,
				subjectType: GrantSubjectType.User,
				scopeResourceId: command.subjectId,
				state: MemoryDatasetState.Active,
			},
			select: { id: true, cogneeDatasetId: true },
		});
		return dataset === null ? null : { datasetId: dataset.id, cogneeDatasetId: dataset.cogneeDatasetId };
	}
}
