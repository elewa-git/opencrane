import { MemoryDatasetState, MemoryOutboxEventKind } from "@prisma/client";
import { MemoryFactProvenanceSourceKinds } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { MemoryCatalogAtomicStatuses, MemoryFactConsentStates } from "../memory-catalog.types.js";
import { PrismaMemoryCatalogRepository } from "../prisma-memory-catalog-repository.js";

/** Builds a valid, content-free catalog persistence command. */
function _Command()
{
	return { datasetId: "dataset-1", cogneeExternalId: "cognee-fact-1", contentDigest: `sha256:${"a".repeat(64)}`, consentState: MemoryFactConsentStates.Explicit, sensitivity: "ordinary", provenance: { user_statement: true, sourceKind: MemoryFactProvenanceSourceKinds.ExplicitUserFact, sourceUserId: "user-1" }, source: { artifactRevisionId: null, messageId: null, explicitUserStatement: true, explicitUserId: "user-1" }, supersedesFactId: null, recordedBy: "user-1", idempotencyKey: "fact-1" };
}

/** Builds the Prisma transaction fake that exposes the catalog's complete persistence boundary. */
function _Transaction()
{
	return {
		$queryRaw: vi.fn(),
		memoryOutboxEvent: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
		memoryDataset: { findUnique: vi.fn().mockResolvedValue({ state: MemoryDatasetState.Active }) },
		memoryFactCatalog: { create: vi.fn().mockResolvedValue({ id: "fact-1" }) },
	};
}

describe("Prisma memory catalog repository", function _DescribePrismaMemoryCatalogRepository()
{
	it("commits immutable catalog metadata and the recorded-fact outbox intent together", async function _Records()
	{
		const transaction = _Transaction();
		await expect(new PrismaMemoryCatalogRepository(transaction as never).recordFactAtomically(_Command())).resolves.toEqual({ status: MemoryCatalogAtomicStatuses.Recorded });
		expect(transaction.memoryFactCatalog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ datasetId: "dataset-1", cogneeExternalId: "cognee-fact-1", sourceArtifactRevisionId: null, sourceMessageId: null }) }));
		expect(transaction.memoryOutboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ datasetId: "dataset-1", factId: "fact-1", kind: MemoryOutboxEventKind.FactRecorded, idempotencyKey: "fact-1" }) }));
	});

	it("denies an unavailable or retired dataset without creating catalog or outbox rows", async function _DeniesUnavailableDataset()
	{
		const transaction = _Transaction();
		transaction.memoryDataset.findUnique.mockResolvedValue(null);
		await expect(new PrismaMemoryCatalogRepository(transaction as never).recordFactAtomically(_Command())).resolves.toEqual({ status: MemoryCatalogAtomicStatuses.DatasetNotFound });
		expect(transaction.memoryFactCatalog.create).not.toHaveBeenCalled();
		expect(transaction.memoryOutboxEvent.create).not.toHaveBeenCalled();
	});

	it("accepts only an exact prior fact for a repeated idempotency key", async function _AcceptsExactIdempotency()
	{
		const transaction = _Transaction();
		const command = _Command();
		transaction.memoryOutboxEvent.findUnique.mockResolvedValue({ datasetId: command.datasetId, kind: MemoryOutboxEventKind.FactRecorded, fact: { cogneeExternalId: command.cogneeExternalId, contentDigest: command.contentDigest, consentState: "Explicit", sensitivity: command.sensitivity, provenance: command.provenance, sourceArtifactRevisionId: null, sourceMessageId: null, supersedesFactId: null, recordedBy: command.recordedBy } });
		await expect(new PrismaMemoryCatalogRepository(transaction as never).recordFactAtomically(command)).resolves.toEqual({ status: MemoryCatalogAtomicStatuses.Idempotent });
		expect(transaction.memoryDataset.findUnique).not.toHaveBeenCalled();
		expect(transaction.memoryFactCatalog.create).not.toHaveBeenCalled();
	});

	it("emits a correction event rather than a first-recording event for a successor fact", async function _EmitsCorrection()
	{
		const transaction = _Transaction();
		await expect(new PrismaMemoryCatalogRepository(transaction as never).recordFactAtomically({ ..._Command(), supersedesFactId: "fact-previous" })).resolves.toEqual({ status: MemoryCatalogAtomicStatuses.Recorded });
		expect(transaction.memoryOutboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: MemoryOutboxEventKind.FactCorrected, payload: expect.objectContaining({ supersedesFactId: "fact-previous" }) }) }));
	});
});
