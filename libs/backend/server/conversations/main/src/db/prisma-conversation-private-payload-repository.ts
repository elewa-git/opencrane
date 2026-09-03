import type { Prisma } from "@prisma/client";

import type { ConversationPrivatePayloadRecord, ConversationPrivatePayloadRepository, ConversationPrivatePayloadStoreCommand } from "../conversation-private-payload-store.types";

/**
 * Implements private-payload persistence with the transaction an authority already holds.
 *
 * The adapter never creates its own Prisma client, so the authority can make the payload row and a
 * related history append part of the transaction it controls.
 * @implements ConversationPrivatePayloadRepository
 */
export class PrismaConversationPrivatePayloadRepository implements ConversationPrivatePayloadRepository
{
	/** Executes payload reads and writes in the caller's transaction. */
	private readonly transaction: Prisma.TransactionClient;

	/**
	 * Binds this adapter to an existing transaction.
	 *
	 * @param transaction - The Prisma transaction that also owns the caller's wider operation.
	 */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/**
	 * Finds the row for one owner key.
	 *
	 * @param command - The broader store command that supplies the three persisted key fields.
	 * @returns The row that owns the key, or `null` if the key is unused.
	 */
	async find(command: Pick<ConversationPrivatePayloadStoreCommand, "siloId" | "conversationId" | "idempotencyKey">): Promise<ConversationPrivatePayloadRecord | null>
	{
		const record = await this.transaction.conversationPrivatePayload.findUnique({
			where: { siloId_conversationId_idempotencyKey: _OwnerKey(command) },
		});
		return record === null ? null : _Record(record);
	}

	/** Loads one payload record by the UUID carried in a protected command reference. */
	async findById(id: string): Promise<ConversationPrivatePayloadRecord | null>
	{
		const record = await this.transaction.conversationPrivatePayload.findUnique({ where: { id } });
		return record === null ? null : _Record(record);
	}

	/**
	 * Inserts a candidate without replacing the row that already owns its key.
	 *
	 * @param record - The encrypted row the store prepared after it found no existing row.
	 * @returns Nothing; the store reads again to discover the retained row.
	 */
	async createIfAbsent(record: ConversationPrivatePayloadRecord): Promise<void>
	{
		const data = {
			...record,
			ciphertext: Buffer.from(record.ciphertext),
			nonce: Buffer.from(record.nonce),
			authenticationTag: Buffer.from(record.authenticationTag),
		};
		await this.transaction.conversationPrivatePayload.createMany({ data: [data], skipDuplicates: true });
	}
}

/** Selects the three fields Prisma uses for the private-payload unique key. */
function _OwnerKey(command: Pick<ConversationPrivatePayloadStoreCommand, "siloId" | "conversationId" | "idempotencyKey">): { siloId: string; conversationId: string; idempotencyKey: string }
{
	return { siloId: command.siloId, conversationId: command.conversationId, idempotencyKey: command.idempotencyKey };
}

/** Converts Prisma's stored bytes into the record shared with the private-payload store. */
function _Record(record: Prisma.ConversationPrivatePayloadGetPayload<{}>): ConversationPrivatePayloadRecord
{
	return {
		id: record.id,
		siloId: record.siloId,
		conversationId: record.conversationId,
		idempotencyKey: record.idempotencyKey,
		plaintextDigest: record.plaintextDigest as `sha256:${string}`,
		ciphertextDigest: record.ciphertextDigest as `sha256:${string}`,
		keyId: record.keyId,
		ciphertext: record.ciphertext,
		nonce: record.nonce,
		authenticationTag: record.authenticationTag,
	};
}
