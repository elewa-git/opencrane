import { MemoryDatasetState, MemoryOutboxEventKind, Prisma } from "@prisma/client";

import { ___CanonicalizeJson } from "@opencrane/util";

import { __IsValidMemoryFactCommand } from "./memory-catalog.js";
import { MemoryCatalogAtomicStatuses, MemoryFactConsentStates } from "./memory-catalog.types.js";
import type { AtomicRecordMemoryFactResult, MemoryCatalogRepository, RecordMemoryFactCommand } from "./memory-catalog.types.js";

/** Prisma persistence authority for immutable memory-fact catalog records and their outbox intents. */
export class PrismaMemoryCatalogRepository implements MemoryCatalogRepository
{
	/** Transaction-scoped product database client supplied only by the catalog unit of work. */
	private readonly transaction: Prisma.TransactionClient;

	/** Creates the catalog persistence authority over one active product transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Atomically records gateway-confirmed metadata and the downstream fact-recorded intent. */
	async recordFactAtomically(command: RecordMemoryFactCommand): Promise<AtomicRecordMemoryFactResult>
	{
		if (!__IsValidMemoryFactCommand(command)) return { status: MemoryCatalogAtomicStatuses.InvalidCommand };

		// 1. Reuse only an identical prior delivery so an idempotency key cannot authorize changed evidence.
		const existing = await this.transaction.memoryOutboxEvent.findUnique({ where: { idempotencyKey: command.idempotencyKey }, include: { fact: true } });
		if (existing !== null) return __MatchesExistingMemoryDelivery(existing, command) ? { status: MemoryCatalogAtomicStatuses.Idempotent } : { status: MemoryCatalogAtomicStatuses.Conflict };

		// 2. Lock then reject unavailable catalog targets; the baseline trigger repeats this fence at commit.
		await this.transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "memory_datasets" WHERE "id" = ${command.datasetId} FOR UPDATE`);
		const dataset = await this.transaction.memoryDataset.findUnique({ where: { id: command.datasetId }, select: { state: true } });
		if (dataset === null) return { status: MemoryCatalogAtomicStatuses.DatasetNotFound };
		if (dataset.state === MemoryDatasetState.Retired) return { status: MemoryCatalogAtomicStatuses.DatasetRetired };

		// 3. Commit immutable metadata and its delivery intent together, leaving durable content exclusively in Cognee.
		const fact = await this.transaction.memoryFactCatalog.create({ data: { datasetId: command.datasetId, cogneeExternalId: command.cogneeExternalId, contentDigest: command.contentDigest, consentState: command.consentState === MemoryFactConsentStates.Explicit ? "Explicit" : "Confirmed", sensitivity: command.sensitivity, provenance: command.provenance as Prisma.InputJsonValue, sourceArtifactRevisionId: command.source.artifactRevisionId, sourceMessageId: command.source.messageId, supersedesFactId: command.supersedesFactId, recordedBy: command.recordedBy }, select: { id: true } });
		await this.transaction.memoryOutboxEvent.create({ data: { datasetId: command.datasetId, factId: fact.id, kind: _OutboxKind(command), idempotencyKey: command.idempotencyKey, payload: _OutboxPayload(command) } });
		return { status: MemoryCatalogAtomicStatuses.Recorded };
	}
}

/** Return whether an already-committed idempotency key represents the exact same immutable fact. */
export function __MatchesExistingMemoryDelivery(existing: { readonly datasetId: string; readonly kind: MemoryOutboxEventKind; readonly fact: { readonly cogneeExternalId: string; readonly contentDigest: string; readonly consentState: "Explicit" | "Confirmed"; readonly sensitivity: string; readonly provenance: unknown; readonly sourceArtifactRevisionId: string | null; readonly sourceMessageId: string | null; readonly supersedesFactId: string | null; readonly recordedBy: string } }, command: RecordMemoryFactCommand): boolean
{
	return existing.kind === _OutboxKind(command)
		&& existing.datasetId === command.datasetId
		&& existing.fact.cogneeExternalId === command.cogneeExternalId
		&& existing.fact.contentDigest === command.contentDigest
		&& existing.fact.consentState === (command.consentState === MemoryFactConsentStates.Explicit ? "Explicit" : "Confirmed")
		&& existing.fact.sensitivity === command.sensitivity
		&& ___CanonicalizeJson(existing.fact.provenance as never) === ___CanonicalizeJson(command.provenance)
		&& existing.fact.sourceArtifactRevisionId === command.source.artifactRevisionId
		&& existing.fact.sourceMessageId === command.source.messageId
		&& existing.fact.supersedesFactId === command.supersedesFactId
		&& existing.fact.recordedBy === command.recordedBy;
}

/** Select the one event that tells consumers whether a fact is newly recorded or replaces another. */
function _OutboxKind(command: RecordMemoryFactCommand): MemoryOutboxEventKind
{
	return command.supersedesFactId === null ? MemoryOutboxEventKind.FactRecorded : MemoryOutboxEventKind.FactCorrected;
}

/** Build the content-free delivery payload used by downstream catalog consumers. */
function _OutboxPayload(command: RecordMemoryFactCommand): Prisma.InputJsonValue
{
	return { cogneeExternalId: command.cogneeExternalId, contentDigest: command.contentDigest, consentState: command.consentState, sensitivity: command.sensitivity, provenance: command.provenance as unknown as Prisma.InputJsonValue, source: command.source as unknown as Prisma.InputJsonValue, supersedesFactId: command.supersedesFactId, recordedBy: command.recordedBy } as Prisma.InputJsonObject;
}
