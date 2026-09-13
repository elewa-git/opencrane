import { AuthorizationBoundaryKind, MemoryDatasetState, MemoryFactState, type Prisma } from "@prisma/client";

import { PersonalMemoryCommandDatasetStates, PersonalMemoryCommandFactStates, type PersonalMemoryCommandContextCoordinates, type PersonalMemoryCommandContextRepository, type PersonalMemoryCommandDataset, type PersonalMemoryCommandTargetFact } from "./personal-memory-command-context.types";

/** Maps generated dataset states to the domain vocabulary exposed by this repository. */
const _DATASET_STATE_FROM_PRISMA: Readonly<Record<MemoryDatasetState, PersonalMemoryCommandDatasetStates>> = {
	[MemoryDatasetState.Provisioning]: PersonalMemoryCommandDatasetStates.Provisioning,
	[MemoryDatasetState.Active]: PersonalMemoryCommandDatasetStates.Active,
	[MemoryDatasetState.Retired]: PersonalMemoryCommandDatasetStates.Retired,
};

/** Maps generated fact states to the domain vocabulary exposed by this repository. */
const _FACT_STATE_FROM_PRISMA: Readonly<Record<MemoryFactState, PersonalMemoryCommandFactStates>> = {
	[MemoryFactState.Active]: PersonalMemoryCommandFactStates.Active,
	[MemoryFactState.Corrected]: PersonalMemoryCommandFactStates.Corrected,
	[MemoryFactState.ForgetPending]: PersonalMemoryCommandFactStates.ForgetPending,
	[MemoryFactState.Forgotten]: PersonalMemoryCommandFactStates.Forgotten,
};

/** Owns dataset and target metadata inside the authenticated memory command transaction. */
export class PrismaPersonalMemoryCommandContextRepository implements PersonalMemoryCommandContextRepository
{
	/** Keeps domain reads and first-dataset creation in the caller's commit boundary. */
	public constructor(private readonly transaction: Prisma.TransactionClient) {}

	/** Finds only the exact personal boundary; retired state is returned so callers fail closed. */
	public async findDataset(coordinates: PersonalMemoryCommandContextCoordinates): Promise<PersonalMemoryCommandDataset | null>
	{
		const dataset = await this.transaction.memoryDataset.findFirst({
			where: { siloId: coordinates.siloId, boundaryKind: AuthorizationBoundaryKind.Personal, boundaryPrincipalId: coordinates.principalId, boundaryGroupId: null },
			select: { id: true, state: true, cogneeDatasetId: true },
		});
		return dataset === null ? null : { ...dataset, state: _DATASET_STATE_FROM_PRISMA[dataset.state] };
	}

	/**
	 * Creates a personal dataset after the owning transaction admits collection Create authority.
	 * The same transaction must install the exact owner grants and admit the operation and task.
	 * An error at any later step must roll this creation back. The personal-boundary unique index
	 * resolves concurrent creators through the caller's existing Serializable retry policy.
	 */
	public async createDataset(coordinates: PersonalMemoryCommandContextCoordinates, datasetId: string, now: Date): Promise<PersonalMemoryCommandDataset>
	{
		const dataset = await this.transaction.memoryDataset.create({
			data: { id: datasetId, siloId: coordinates.siloId, boundaryKind: AuthorizationBoundaryKind.Personal, boundaryPrincipalId: coordinates.principalId, boundaryGroupId: null, state: MemoryDatasetState.Provisioning, cogneeDatasetId: null, createdBy: coordinates.principalId, createdAt: now },
			select: { id: true, state: true, cogneeDatasetId: true },
		});
		return { ...dataset, state: _DATASET_STATE_FROM_PRISMA[dataset.state] };
	}

	/** Reads the selected fact only within the actor-owned dataset resolved by command admission. */
	public async findTarget(datasetId: string, factId: string): Promise<PersonalMemoryCommandTargetFact | null>
	{
		const fact = await this.transaction.memoryFactCatalog.findFirst({ where: { id: factId, datasetId }, select: { id: true, cogneeExternalId: true, revision: true, state: true } });
		return fact === null ? null : { ...fact, state: _FACT_STATE_FROM_PRISMA[fact.state] };
	}
}
