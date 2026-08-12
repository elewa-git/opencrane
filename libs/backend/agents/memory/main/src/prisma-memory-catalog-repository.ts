import { MemoryDatasetState, MemoryOutboxEventKind, type MemoryConsentState, type Prisma } from "@prisma/client";

import { ___CanonicalizeJson } from "@opencrane/util";

import { __IsValidMemoryFactCommand } from "./memory-catalog.js";
import { MemoryCatalogAtomicStatuses, MemoryFactConsentStates } from "./memory-catalog.types.js";
import type { AtomicRecordMemoryFactResult, MemoryCatalogRepository, RecordMemoryFactCommand } from "./memory-catalog.types.js";

/**
 * Writes memory-fact catalog rows and their outbox events, inside a transaction it is given.
 *
 * Deliberately has no `PrismaClient` of its own: it can only ever act inside a transaction
 * opened by {@link PrismaMemoryCatalogUnitOfWork}, which is what keeps the metadata row and its
 * outbox event from committing separately.
 *
 * Constructed by: {@link PrismaMemoryCatalogUnitOfWork.run}.
 *
 * @implements MemoryCatalogRepository
 */
export class PrismaMemoryCatalogRepository implements MemoryCatalogRepository
{
	/** Database client for one open transaction; only PrismaMemoryCatalogUnitOfWork supplies it. */
	private readonly transaction: Prisma.TransactionClient;

	/** Creates the catalog persistence authority over one active product transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/**
	 * Records the fact's metadata row and its outbox event in the caller's transaction, or neither.
	 *
	 * Re-runs {@link __IsValidMemoryFactCommand} first, so a caller holding this repository
	 * directly cannot bypass the source and consent rules.
	 *
	 * @param command - The fact to record, already stored in Cognee.
	 * @returns `Recorded` when both rows were created; `Idempotent` when this `idempotencyKey`
	 * already holds the identical fact, in which case nothing is written and no dataset lookup
	 * happens; `InvalidCommand`, `DatasetNotFound` or `DatasetRetired` when refused, again with
	 * nothing written; `Conflict` when the key was reused for different content.
	 * @throws Prisma.PrismaClientKnownRequestError from the database trigger when a correction
	 * names a fact that is not active, or when a unique index rejects the insert. Both roll the
	 * caller's transaction back and are handled by {@link PrismaMemoryCatalogUnitOfWork}.
	 */
	async recordFactAtomically(command: RecordMemoryFactCommand): Promise<AtomicRecordMemoryFactResult>
	{
		if (!__IsValidMemoryFactCommand(command)) return { status: MemoryCatalogAtomicStatuses.InvalidCommand };

		// 1. Reuse an earlier write only when it holds the identical fact, so an idempotency key cannot smuggle in different content.
		const existing = await this.transaction.memoryOutboxEvent.findUnique({ where: { idempotencyKey: command.idempotencyKey }, include: { fact: true } });
		if (existing !== null) return __MatchesExistingMemoryDelivery(existing, command) ? { status: MemoryCatalogAtomicStatuses.Idempotent } : { status: MemoryCatalogAtomicStatuses.Conflict };

		// 2. Refuse a missing or retired dataset. If another transaction retires it at the same time,
		// serializable isolation turns that into a retried conflict, and the database trigger checks the dataset again on insert.
		const dataset = await this.transaction.memoryDataset.findUnique({ where: { id: command.datasetId }, select: { state: true } });
		if (dataset === null) return { status: MemoryCatalogAtomicStatuses.DatasetNotFound };
		if (dataset.state === MemoryDatasetState.Retired) return { status: MemoryCatalogAtomicStatuses.DatasetRetired };

		// 3. Commit immutable metadata and its delivery intent together, leaving durable content exclusively in Cognee.
		const fact = await this.transaction.memoryFactCatalog.create({ data: { datasetId: command.datasetId, cogneeExternalId: command.cogneeExternalId, contentDigest: command.contentDigest, consentState: _PersistedConsentState(command), sensitivity: command.sensitivity, provenance: command.provenance as Prisma.InputJsonValue, sourceArtifactRevisionId: command.source.artifactRevisionId, sourceMessageId: command.source.messageId, supersedesFactId: command.supersedesFactId, recordedBy: command.recordedBy }, select: { id: true } });
		await this.transaction.memoryOutboxEvent.create({ data: { datasetId: command.datasetId, factId: fact.id, kind: _OutboxKind(command), idempotencyKey: command.idempotencyKey, payload: _OutboxPayload(command) } });
		return { status: MemoryCatalogAtomicStatuses.Recorded };
	}
}

/**
 * Returns whether the row already committed under an idempotency key holds the identical fact.
 *
 * Compares every field that identifies the fact, including the provenance JSON in canonical
 * form so key order alone cannot make two identical facts look different. Any mismatch means the
 * key was reused for different content, which is a `Conflict` and never an idempotent repeat.
 *
 * Called by: {@link PrismaMemoryCatalogRepository.recordFactAtomically} before it inserts, and
 * {@link PrismaMemoryCatalogCollisionRepository.resolveUniqueCollision} after a rollback.
 *
 * @param existing - The committed outbox event and its fact row.
 * @param command - The command being attempted.
 * @returns True only when the two describe the same fact in every compared field.
 * @see https://www.rfc-editor.org/rfc/rfc8785 — RFC 8785 (JSON Canonicalization Scheme), the
 * rules `___CanonicalizeJson` applies before the provenance comparison.
 */
export function __MatchesExistingMemoryDelivery(existing: { readonly datasetId: string; readonly kind: MemoryOutboxEventKind; readonly fact: { readonly cogneeExternalId: string; readonly contentDigest: string; readonly consentState: "Explicit" | "Confirmed"; readonly sensitivity: string; readonly provenance: unknown; readonly sourceArtifactRevisionId: string | null; readonly sourceMessageId: string | null; readonly supersedesFactId: string | null; readonly recordedBy: string } }, command: RecordMemoryFactCommand): boolean
{
	return existing.kind === _OutboxKind(command)
		&& existing.datasetId === command.datasetId
		&& existing.fact.cogneeExternalId === command.cogneeExternalId
		&& existing.fact.contentDigest === command.contentDigest
		&& existing.fact.consentState === _PersistedConsentState(command)
		&& existing.fact.sensitivity === command.sensitivity
		&& ___CanonicalizeJson(existing.fact.provenance as never) === ___CanonicalizeJson(command.provenance)
		&& existing.fact.sourceArtifactRevisionId === command.source.artifactRevisionId
		&& existing.fact.sourceMessageId === command.source.messageId
		&& existing.fact.supersedesFactId === command.supersedesFactId
		&& existing.fact.recordedBy === command.recordedBy;
}

/** Picks FactRecorded for a new fact, or FactCorrected when it replaces an earlier one. */
function _OutboxKind(command: RecordMemoryFactCommand): MemoryOutboxEventKind
{
	return command.supersedesFactId === null ? MemoryOutboxEventKind.FactRecorded : MemoryOutboxEventKind.FactCorrected;
}

/** Map the command's domain consent state onto the persisted Prisma consent vocabulary. */
function _PersistedConsentState(command: RecordMemoryFactCommand): MemoryConsentState
{
	return command.consentState === MemoryFactConsentStates.Explicit ? "Explicit" : "Confirmed";
}

/** Builds the outbox payload for downstream consumers; it carries no fact content. */
function _OutboxPayload(command: RecordMemoryFactCommand): Prisma.InputJsonValue
{
	return { cogneeExternalId: command.cogneeExternalId, contentDigest: command.contentDigest, consentState: command.consentState, sensitivity: command.sensitivity, provenance: command.provenance as unknown as Prisma.InputJsonValue, source: command.source as unknown as Prisma.InputJsonValue, supersedesFactId: command.supersedesFactId, recordedBy: command.recordedBy } as Prisma.InputJsonObject;
}
