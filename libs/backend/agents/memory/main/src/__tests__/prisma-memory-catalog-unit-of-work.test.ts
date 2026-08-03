import { MemoryOutboxEventKind, Prisma } from "@prisma/client";
import { MemoryFactProvenanceSourceKinds } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { __MemoryCatalogCorrectionConflictError } from "../memory-catalog-errors.js";
import { MemoryCatalogAtomicStatuses, MemoryFactConsentStates } from "../memory-catalog.types.js";
import { PrismaMemoryCatalogUnitOfWork } from "../prisma-memory-catalog-unit-of-work.js";

/** Builds a transaction facade sufficient for the unit of work to construct its repository. */
function _Transaction()
{
	return {
		memoryOutboxEvent: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
		memoryDataset: { findUnique: vi.fn().mockResolvedValue({ state: "Active" }) },
		memoryFactCatalog: { create: vi.fn().mockResolvedValue({ id: "fact-1" }) },
	};
}

/** Builds a valid correction command that reaches the database correction trigger. */
function _CorrectionCommand()
{
	return { datasetId: "dataset-1", cogneeExternalId: "cognee-fact-1", contentDigest: `sha256:${"a".repeat(64)}`, consentState: MemoryFactConsentStates.Explicit, sensitivity: "ordinary", provenance: { user_statement: true, sourceKind: MemoryFactProvenanceSourceKinds.ExplicitUserFact, sourceUserId: "user-1" }, source: { artifactRevisionId: null, messageId: null, explicitUserStatement: true, explicitUserId: "user-1" }, supersedesFactId: "fact-previous", recordedBy: "user-1", idempotencyKey: "fact-1" };
}

/** Reconstructs the committed content-free delivery used for post-rollback idempotency resolution. */
function _CommittedDelivery(command: ReturnType<typeof _CorrectionCommand>)
{
	return { datasetId: command.datasetId, kind: MemoryOutboxEventKind.FactCorrected, fact: { cogneeExternalId: command.cogneeExternalId, contentDigest: command.contentDigest, consentState: "Explicit", sensitivity: command.sensitivity, provenance: command.provenance, sourceArtifactRevisionId: null, sourceMessageId: null, supersedesFactId: command.supersedesFactId, recordedBy: command.recordedBy } };
}

describe("Prisma memory catalog unit of work", function _DescribePrismaMemoryCatalogUnitOfWork()
{
	it("retries a complete serialization conflict with newly constructed transaction repositories", async function _RetriesConflict()
	{
		const transaction = _Transaction();
		const command = _CorrectionCommand();
		const conflict = new Prisma.PrismaClientKnownRequestError("serialization conflict", { code: "P2034", clientVersion: "test" });
		const prisma = { $transaction: vi.fn().mockRejectedValueOnce(conflict).mockImplementation(async function _Commit(work) { return work(transaction); }) };
		const result = await new PrismaMemoryCatalogUnitOfWork(prisma as never).run(command, async function _Work(repositories) { return repositories.catalog.recordFactAtomically(command); });
		expect(result).toEqual({ status: MemoryCatalogAtomicStatuses.Recorded });
		expect(prisma.$transaction).toHaveBeenCalledTimes(2);
	});

	it("translates a rolled-back PostgreSQL correction conflict into the owned domain signal", async function _TranslatesCorrectionConflict()
	{
		const conflict = new Prisma.PrismaClientKnownRequestError("memory correction must supersede an active fact in the same dataset", { code: "P0001", clientVersion: "test" });
		const transaction = _Transaction();
		transaction.memoryFactCatalog.create.mockRejectedValue(conflict);
		const prisma = { $transaction: vi.fn().mockImplementation(async function _Rollback(work) { return work(transaction); }) };
		const command = _CorrectionCommand();
		await expect(new PrismaMemoryCatalogUnitOfWork(prisma as never).run(command, async function _Work(repositories) { return repositories.catalog.recordFactAtomically(command); })).rejects.toBeInstanceOf(__MemoryCatalogCorrectionConflictError);
		expect(prisma.$transaction).toHaveBeenCalledTimes(1);
		expect(transaction.memoryOutboxEvent.create).not.toHaveBeenCalled();
	});

	it("resolves an exact concurrent idempotency collision after one rolled-back attempt", async function _ResolvesConcurrentIdempotency()
	{
		const command = _CorrectionCommand();
		const conflict = new Prisma.PrismaClientKnownRequestError("concurrent idempotency collision", { code: "P2002", clientVersion: "test" });
		const findUnique = vi.fn().mockResolvedValue(_CommittedDelivery(command));
		const prisma = { $transaction: vi.fn().mockRejectedValue(conflict), memoryOutboxEvent: { findUnique } };
		await expect(new PrismaMemoryCatalogUnitOfWork(prisma as never).run(command, async function _Work() { throw new Error("unreachable"); })).resolves.toEqual({ status: MemoryCatalogAtomicStatuses.Idempotent });
		expect(prisma.$transaction).toHaveBeenCalledTimes(1);
		expect(findUnique).toHaveBeenCalledWith({ where: { idempotencyKey: command.idempotencyKey }, include: { fact: true } });
	});

	it("returns conflict when a concurrent delivery reused the idempotency key for changed evidence", async function _DeniesConcurrentChangedEvidence()
	{
		const command = _CorrectionCommand();
		const conflict = new Prisma.PrismaClientKnownRequestError("concurrent idempotency collision", { code: "P2002", clientVersion: "test" });
		const committed = _CommittedDelivery(command);
		const findUnique = vi.fn().mockResolvedValue({ ...committed, fact: { ...committed.fact, contentDigest: `sha256:${"b".repeat(64)}` } });
		const prisma = { $transaction: vi.fn().mockRejectedValue(conflict), memoryOutboxEvent: { findUnique } };
		await expect(new PrismaMemoryCatalogUnitOfWork(prisma as never).run(command, async function _Work() { throw new Error("unreachable"); })).resolves.toEqual({ status: MemoryCatalogAtomicStatuses.Conflict });
		expect(prisma.$transaction).toHaveBeenCalledTimes(1);
	});

	it("returns conflict for a sequential dataset coordinate collision under a different idempotency key", async function _DeniesSequentialCoordinateCollision()
	{
		const command = { ..._CorrectionCommand(), idempotencyKey: "fact-2" };
		const conflict = new Prisma.PrismaClientKnownRequestError("dataset and Cognee coordinate already exists", { code: "P2002", clientVersion: "test" });
		const transaction = _Transaction();
		transaction.memoryFactCatalog.create.mockRejectedValue(conflict);
		const findUnique = vi.fn().mockResolvedValue(null);
		const prisma = { $transaction: vi.fn().mockImplementation(async function _Rollback(work) { return work(transaction); }), memoryOutboxEvent: { findUnique } };
		await expect(new PrismaMemoryCatalogUnitOfWork(prisma as never).run(command, async function _Work(repositories) { return repositories.catalog.recordFactAtomically(command); })).resolves.toEqual({ status: MemoryCatalogAtomicStatuses.Conflict });
		expect(prisma.$transaction).toHaveBeenCalledTimes(1);
		expect(findUnique).toHaveBeenCalledWith({ where: { idempotencyKey: "fact-2" }, include: { fact: true } });
		expect(transaction.memoryOutboxEvent.create).not.toHaveBeenCalled();
	});
});
