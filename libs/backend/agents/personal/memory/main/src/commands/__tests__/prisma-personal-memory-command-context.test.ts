import { AuthorizationBoundaryKind, MemoryDatasetState, MemoryFactState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PersonalMemoryCommandDatasetStates, PersonalMemoryCommandFactStates } from "../personal-memory-command-context.types";
import { PrismaPersonalMemoryCommandContextRepository } from "../prisma-personal-memory-command-context";

const _Coordinates = { siloId: "silo-1", principalId: "principal-1" } as const;
const _CreatedAt = new Date("2026-09-13T09:00:00.000Z");

describe("PrismaPersonalMemoryCommandContextRepository", function _Suite()
{
	it("selects the exact personal boundary and returns its retired state", async function _FindDataset()
	{
		const retired = { id: "dataset-1", state: MemoryDatasetState.Retired, cogneeDatasetId: "00000000-0000-4000-8000-000000000001" };
		const transaction = _Transaction();
		transaction.memoryDataset.findFirst.mockResolvedValueOnce(retired);
		const repository = new PrismaPersonalMemoryCommandContextRepository(transaction as never);

		await expect(repository.findDataset(_Coordinates)).resolves.toEqual({ ...retired, state: PersonalMemoryCommandDatasetStates.Retired });
		expect(transaction.memoryDataset.findFirst).toHaveBeenCalledWith({
			where: { siloId: _Coordinates.siloId, boundaryKind: AuthorizationBoundaryKind.Personal, boundaryPrincipalId: _Coordinates.principalId, boundaryGroupId: null },
			select: { id: true, state: true, cogneeDatasetId: true },
		});
	});

	it("creates an explicit Provisioning dataset without a provider UUID", async function _CreateDataset()
	{
		const created = { id: "dataset-1", state: MemoryDatasetState.Provisioning, cogneeDatasetId: null };
		const transaction = _Transaction();
		transaction.memoryDataset.create.mockResolvedValueOnce(created);
		const repository = new PrismaPersonalMemoryCommandContextRepository(transaction as never);

		await expect(repository.createDataset(_Coordinates, created.id, _CreatedAt)).resolves.toEqual({ ...created, state: PersonalMemoryCommandDatasetStates.Provisioning });
		expect(transaction.memoryDataset.create).toHaveBeenCalledWith({
			data: {
				id: created.id,
				siloId: _Coordinates.siloId,
				boundaryKind: AuthorizationBoundaryKind.Personal,
				boundaryPrincipalId: _Coordinates.principalId,
				boundaryGroupId: null,
				state: MemoryDatasetState.Provisioning,
				cogneeDatasetId: null,
				createdBy: _Coordinates.principalId,
				createdAt: _CreatedAt,
			},
			select: { id: true, state: true, cogneeDatasetId: true },
		});
	});

	it("looks up a target fact only by its dataset and fact identifiers", async function _FindTarget()
	{
		const fact = { id: "fact-1", cogneeExternalId: "00000000-0000-4000-8000-000000000002", revision: 7, state: MemoryFactState.Corrected };
		const transaction = _Transaction();
		transaction.memoryFactCatalog.findFirst.mockResolvedValueOnce(fact);
		const repository = new PrismaPersonalMemoryCommandContextRepository(transaction as never);

		await expect(repository.findTarget("dataset-1", fact.id)).resolves.toEqual({ ...fact, state: PersonalMemoryCommandFactStates.Corrected });
		expect(transaction.memoryFactCatalog.findFirst).toHaveBeenCalledWith({
			where: { id: fact.id, datasetId: "dataset-1" },
			select: { id: true, cogneeExternalId: true, revision: true, state: true },
		});
	});
});

/** Builds only the Prisma delegates owned by command context preparation. */
function _Transaction()
{
	return {
		memoryDataset: { findFirst: vi.fn(), create: vi.fn() },
		memoryFactCatalog: { findFirst: vi.fn() },
	};
}
