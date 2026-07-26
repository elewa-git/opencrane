import { MemoryDatasetState, MemoryOutboxEventKind, Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaMemoryCatalogRepository } from "../prisma-memory-catalog-repository.js";

/** Build a valid, content-free catalog persistence command. */
function _command()
{
	return { datasetId: "dataset-1", cogneeExternalId: "cognee-fact-1", contentDigest: `sha256:${"a".repeat(64)}`, consentState: "explicit" as const, sensitivity: "ordinary", provenance: { user_statement: true, sourceKind: "explicit-user-fact", sourceUserId: "user-1" }, source: { artifactRevisionId: null, messageId: null, explicitUserStatement: true, explicitUserId: "user-1" }, supersedesFactId: null, recordedBy: "user-1", idempotencyKey: "fact-1" };
}

/** Build a Prisma transaction fake that exposes the memory catalog's entire atomic boundary. */
function _transaction()
{
	return {
		$queryRaw: vi.fn(),
		memoryOutboxEvent: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
		memoryDataset: { findUnique: vi.fn().mockResolvedValue({ state: MemoryDatasetState.Active }), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
		memoryFactCatalog: { create: vi.fn().mockResolvedValue({ id: "fact-1" }) },
	};
}

/** Create a repository with a transaction fake for deterministic persistence-boundary tests. */
function _repository(transaction: ReturnType<typeof _transaction>, idempotencyDelivery: unknown = null): PrismaMemoryCatalogRepository
{
	const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }), memoryOutboxEvent: { findUnique: vi.fn().mockResolvedValue(idempotencyDelivery) } } as never;
	return new PrismaMemoryCatalogRepository(prisma);
}

describe("Prisma memory catalog repository", function _suite()
{
	it("commits immutable catalog metadata and the recorded-fact outbox intent together", async function _records()
	{
		const transaction = _transaction();
		await expect(_repository(transaction).recordFactAtomically(_command())).resolves.toEqual({ status: "recorded" });
		expect(transaction.memoryFactCatalog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ datasetId: "dataset-1", cogneeExternalId: "cognee-fact-1", sourceArtifactRevisionId: null, sourceMessageId: null }) }));
		expect(transaction.memoryOutboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ datasetId: "dataset-1", factId: "fact-1", kind: MemoryOutboxEventKind.FactRecorded, idempotencyKey: "fact-1" }) }));
	});

	it("denies an unavailable dataset without creating catalog or outbox rows", async function _datasetMissing()
	{
		const transaction = _transaction();
		transaction.memoryDataset.findUnique.mockResolvedValue(null);
		await expect(_repository(transaction).recordFactAtomically(_command())).resolves.toEqual({ status: "dataset_not_found" });
		expect(transaction.memoryFactCatalog.create).not.toHaveBeenCalled();
		expect(transaction.memoryOutboxEvent.create).not.toHaveBeenCalled();
	});

	it("denies a retired dataset without creating catalog or outbox rows", async function _datasetRetired()
	{
		const transaction = _transaction();
		transaction.memoryDataset.findUnique.mockResolvedValue({ state: MemoryDatasetState.Retired });
		await expect(_repository(transaction).recordFactAtomically(_command())).resolves.toEqual({ status: "dataset_retired" });
		expect(transaction.memoryFactCatalog.create).not.toHaveBeenCalled();
	});

	it("accepts only an exact prior fact for a repeated idempotency key", async function _idempotent()
	{
		const transaction = _transaction();
		const command = _command();
		transaction.memoryOutboxEvent.findUnique.mockResolvedValue({ datasetId: command.datasetId, kind: MemoryOutboxEventKind.FactRecorded, fact: { cogneeExternalId: command.cogneeExternalId, contentDigest: command.contentDigest, consentState: "Explicit", sensitivity: command.sensitivity, provenance: { sourceUserId: "user-1", sourceKind: "explicit-user-fact", user_statement: true }, sourceArtifactRevisionId: null, sourceMessageId: null, supersedesFactId: null, recordedBy: command.recordedBy } });
		await expect(_repository(transaction).recordFactAtomically(command)).resolves.toEqual({ status: "idempotent" });
		expect(transaction.memoryDataset.findUnique).not.toHaveBeenCalled();
		expect(transaction.memoryFactCatalog.create).not.toHaveBeenCalled();
	});

	it("rejects a changed fact behind a reused idempotency key", async function _conflictingIdempotencyKey()
	{
		const transaction = _transaction();
		const command = _command();
		transaction.memoryOutboxEvent.findUnique.mockResolvedValue({ datasetId: command.datasetId, kind: MemoryOutboxEventKind.FactRecorded, fact: { cogneeExternalId: "other-cognee-fact", contentDigest: command.contentDigest, consentState: "Explicit", sensitivity: command.sensitivity, provenance: command.provenance, sourceArtifactRevisionId: null, sourceMessageId: null, supersedesFactId: null, recordedBy: command.recordedBy } });
		await expect(_repository(transaction).recordFactAtomically(command)).resolves.toEqual({ status: "conflict" });
		expect(transaction.memoryFactCatalog.create).not.toHaveBeenCalled();
	});

	it("rejects an explicit fact whose author differs from its provenance owner before a transaction", async function _wrongExplicitOwner()
	{
		const transaction = _transaction();
		const command = { ..._command(), provenance: { user_statement: true, sourceKind: "explicit-user-fact", sourceUserId: "user-2" } };
		await expect(_repository(transaction).recordFactAtomically(command)).resolves.toEqual({ status: "invalid_command" });
		expect(transaction.memoryOutboxEvent.findUnique).not.toHaveBeenCalled();
	});

	it("recovers an exact concurrent idempotency delivery after a unique-key race", async function _concurrentIdempotency()
	{
		const transaction = _transaction();
		const command = _command();
		const delivery = { datasetId: command.datasetId, kind: MemoryOutboxEventKind.FactRecorded, fact: { cogneeExternalId: command.cogneeExternalId, contentDigest: command.contentDigest, consentState: "Explicit", sensitivity: command.sensitivity, provenance: command.provenance, sourceArtifactRevisionId: null, sourceMessageId: null, supersedesFactId: null, recordedBy: command.recordedBy } };
		const prisma = { $transaction: vi.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError("unique key race", { code: "P2002", clientVersion: "test" })), memoryOutboxEvent: { findUnique: vi.fn().mockResolvedValue(delivery) } } as never;
		const repository = new PrismaMemoryCatalogRepository(prisma);
		await expect(repository.recordFactAtomically(command)).resolves.toEqual({ status: "idempotent" });
	});

	it("recovers an exact concurrent idempotency delivery after a transaction serialization race", async function _serializationRace()
	{
		const command = _command();
		const delivery = { datasetId: command.datasetId, kind: MemoryOutboxEventKind.FactRecorded, fact: { cogneeExternalId: command.cogneeExternalId, contentDigest: command.contentDigest, consentState: "Explicit", sensitivity: command.sensitivity, provenance: command.provenance, sourceArtifactRevisionId: null, sourceMessageId: null, supersedesFactId: null, recordedBy: command.recordedBy } };
		const prisma = { $transaction: vi.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError("serialization race", { code: "P2034", clientVersion: "test" })), memoryOutboxEvent: { findUnique: vi.fn().mockResolvedValue(delivery) } } as never;
		await expect(new PrismaMemoryCatalogRepository(prisma).recordFactAtomically(command)).resolves.toEqual({ status: "idempotent" });
	});

	it("emits a correction event rather than a first-recording event for a successor fact", async function _correction()
	{
		const transaction = _transaction();
		const command = { ..._command(), supersedesFactId: "fact-previous" };
		await expect(_repository(transaction).recordFactAtomically(command)).resolves.toEqual({ status: "recorded" });
		expect(transaction.memoryOutboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: MemoryOutboxEventKind.FactCorrected, payload: expect.objectContaining({ supersedesFactId: "fact-previous" }) }) }));
	});

	it("creates one immutable Personal dataset binding and rejects a changed gateway dataset", async function _provisionsPersonalDataset()
	{
		const transaction = _transaction();
		const repository = _repository(transaction);
		const command = { siloId: "silo-1", organizationId: "org-1", subjectId: "user-1", cogneeDatasetId: "cognee-dataset-1", createdBy: "user-1" };
		await expect(repository.provisionPersonalDatasetAtomically(command)).resolves.toEqual({ status: "provisioned" });
		expect(transaction.memoryDataset.create).toHaveBeenCalledWith({ data: { siloId: "silo-1", scopeKind: "Personal", organizationId: "org-1", scopeResourceId: "user-1", cogneeDatasetId: "cognee-dataset-1", createdBy: "user-1" } });
		transaction.memoryDataset.findFirst.mockResolvedValue({ cogneeDatasetId: "other-dataset", state: MemoryDatasetState.Active });
		await expect(repository.provisionPersonalDatasetAtomically(command)).resolves.toEqual({ status: "conflict" });
	});

	it("resolves an identical concurrent provision after a serialization conflict", async function _concurrentProvision()
	{
		const command = { siloId: "silo-1", organizationId: "org-1", subjectId: "user-1", cogneeDatasetId: "cognee-dataset-1", createdBy: "user-1" };
		const prisma = { $transaction: vi.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError("serialization race", { code: "P2034", clientVersion: "test" })), memoryDataset: { findFirst: vi.fn().mockResolvedValue({ cogneeDatasetId: command.cogneeDatasetId, state: MemoryDatasetState.Active }) } } as never;
		await expect(new PrismaMemoryCatalogRepository(prisma).provisionPersonalDatasetAtomically(command)).resolves.toEqual({ status: "idempotent" });
	});
});
