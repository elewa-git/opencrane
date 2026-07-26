import { MemoryDatasetState, MemoryOutboxEventKind, Prisma, type PrismaClient } from "@prisma/client";

import { __IsValidMemoryFactCommand } from "./memory-catalog.js";

import type { AtomicRecordMemoryFactResult, MemoryCatalogRepository, RecordMemoryFactCommand } from "./memory-catalog.types.js";

/** Prisma persistence authority for immutable memory-fact catalog records and their outbox intents. */
export class PrismaMemoryCatalogRepository implements MemoryCatalogRepository
{
	/** Canonical per-silo product database. */
	private readonly prisma: PrismaClient;

	/** Create the catalog persistence authority over the canonical product database. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Atomically record gateway-confirmed metadata and the downstream fact-recorded intent. */
	async recordFactAtomically(command: RecordMemoryFactCommand): Promise<AtomicRecordMemoryFactResult>
	{
		if (!__IsValidMemoryFactCommand(command)) return { status: "invalid_command" };

		try
		{
			return await this.prisma.$transaction(async function _record(transaction)
			{
				// 1. Reuse only an identical prior delivery so an idempotency key cannot authorize changed evidence.
				const existing = await transaction.memoryOutboxEvent.findUnique({ where: { idempotencyKey: command.idempotencyKey }, include: { fact: true } });
				if (existing !== null) return _MatchesExistingDelivery(existing, command) ? { status: "idempotent" } as const : { status: "conflict" } as const;

				// 2. Lock then reject unavailable catalog targets; the baseline trigger repeats this fence at commit.
				await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "memory_datasets" WHERE "id" = ${command.datasetId} FOR UPDATE`);
				const dataset = await transaction.memoryDataset.findUnique({ where: { id: command.datasetId }, select: { state: true } });
				if (dataset === null) return { status: "dataset_not_found" } as const;
				if (dataset.state === MemoryDatasetState.Retired) return { status: "dataset_retired" } as const;

				// 3. Commit immutable metadata and its delivery intent together, leaving durable content exclusively in Cognee.
				const fact = await transaction.memoryFactCatalog.create({ data: { datasetId: command.datasetId, cogneeExternalId: command.cogneeExternalId, contentDigest: command.contentDigest, consentState: command.consentState === "explicit" ? "Explicit" : "Confirmed", sensitivity: command.sensitivity, provenance: command.provenance as Prisma.InputJsonValue, sourceArtifactRevisionId: command.source.artifactRevisionId, sourceMessageId: command.source.messageId, supersedesFactId: command.supersedesFactId, recordedBy: command.recordedBy }, select: { id: true } });
				await transaction.memoryOutboxEvent.create({ data: { datasetId: command.datasetId, factId: fact.id, kind: _OutboxKind(command), idempotencyKey: command.idempotencyKey, payload: _OutboxPayload(command) } });
				return { status: "recorded" } as const;
			});
		}
		catch (error)
		{
			if (error instanceof Prisma.PrismaClientKnownRequestError && _IsCorrectionConflict(error)) return { status: "correction_conflict" };
			if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) return this._ResolveConcurrentIdempotency(command);
			throw error;
		}
	}

	/** Re-read a unique-key race after transaction rollback and accept only the exact committed delivery. */
	private async _ResolveConcurrentIdempotency(command: RecordMemoryFactCommand): Promise<AtomicRecordMemoryFactResult>
	{
		const existing = await this.prisma.memoryOutboxEvent.findUnique({ where: { idempotencyKey: command.idempotencyKey }, include: { fact: true } });
		return existing !== null && _MatchesExistingDelivery(existing, command) ? { status: "idempotent" } : { status: "conflict" };
	}
}

/** Return whether Postgres rejected a correction because its predecessor is no longer eligible. */
function _IsCorrectionConflict(error: Prisma.PrismaClientKnownRequestError): boolean
{
	return error.code === "P0001" && error.message.includes("memory correction must supersede an active fact");
}

/** Return whether an already-committed idempotency key represents the exact same immutable fact. */
function _MatchesExistingDelivery(existing: { readonly datasetId: string; readonly kind: MemoryOutboxEventKind; readonly fact: { readonly cogneeExternalId: string; readonly contentDigest: string; readonly consentState: "Explicit" | "Confirmed"; readonly sensitivity: string; readonly provenance: unknown; readonly sourceArtifactRevisionId: string | null; readonly sourceMessageId: string | null; readonly supersedesFactId: string | null; readonly recordedBy: string } }, command: RecordMemoryFactCommand): boolean
{
	return existing.kind === _OutboxKind(command)
		&& existing.datasetId === command.datasetId
		&& existing.fact.cogneeExternalId === command.cogneeExternalId
		&& existing.fact.contentDigest === command.contentDigest
		&& existing.fact.consentState === (command.consentState === "explicit" ? "Explicit" : "Confirmed")
		&& existing.fact.sensitivity === command.sensitivity
		&& _CanonicalJson(existing.fact.provenance) === _CanonicalJson(command.provenance)
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

/** Serialize JSON deterministically so equivalent provenance objects remain idempotent across key order. */
function _CanonicalJson(value: unknown): string
{
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(function _item(item) { return _CanonicalJson(item); }).join(",")}]`;
	const record = value as Readonly<Record<string, unknown>>;
	return `{${Object.keys(record).sort().map(function _property(key) { return `${JSON.stringify(key)}:${_CanonicalJson(record[key])}`; }).join(",")}}`;
}
