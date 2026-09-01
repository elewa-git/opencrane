import { type PrismaClient } from "@prisma/client";

import type { ConversationPayloadCipher } from "@opencrane/backend/server/infra/conversation-payloads";

import { ConversationPrivatePayloadStore } from "../conversation-private-payload-store";
import type { ConversationPrivatePayloadStore as ConversationPrivatePayloadStorePort, ConversationPrivatePayloadStoreCommand, StoredConversationPrivatePayload } from "../conversation-private-payload-store.types";
import { PrismaConversationPrivatePayloadRepository } from "./prisma-conversation-private-payload-repository";

/**
 * Opens and closes the PostgreSQL transaction that retains one encrypted conversation payload.
 *
 * `ConversationComputerRuntimeOutputAuthority` performs external KurrentDB I/O after this method
 * resolves. Closing the transaction here keeps a database transaction from spanning that history
 * append while preserving the store's idempotent payload row contract.
 */
export class PrismaConversationPrivatePayloadStoreUnitOfWork implements ConversationPrivatePayloadStorePort
{
	/** Opens the transaction that owns the private-payload row and its idempotency decision. */
	private readonly prisma: PrismaClient;
	/** Encrypts text after the store validates the authority's server-derived coordinates. */
	private readonly cipher: ConversationPayloadCipher;

	/** Creates the transaction owner used by the server-mounted payload cipher. */
	constructor(prisma: PrismaClient, cipher: ConversationPayloadCipher)
	{
		this.prisma = prisma;
		this.cipher = cipher;
	}

	/** Stores one encrypted payload and releases the database transaction before history can append. */
	async storeText(command: ConversationPrivatePayloadStoreCommand): Promise<StoredConversationPrivatePayload>
	{
		const unit = this;
		return unit.prisma.$transaction(async function _Store(transaction): Promise<StoredConversationPrivatePayload>
		{
			const repository = new PrismaConversationPrivatePayloadRepository(transaction);
			const store = new ConversationPrivatePayloadStore(repository, unit.cipher);
			return store.storeText(command);
		});
	}
}
