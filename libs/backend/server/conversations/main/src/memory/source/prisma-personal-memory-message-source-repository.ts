import type { Prisma } from "@prisma/client";

import { PrismaConversationHistoryRepository } from "../../messages/db/prisma-conversation-history-repository";
import type { ConversationCaller } from "../../authorization/conversation-caller.types";
import type { PersonalMemoryOperationMessageSource } from "@opencrane/backend/agents/personal/memory";
import type { PersonalMemoryMessageSourceRevalidator } from "./personal-memory-message-source.types";

/** Revalidates conversation source coordinates on the caller's existing SQL transaction. */
export class PrismaPersonalMemoryMessageSourceRepository implements PersonalMemoryMessageSourceRevalidator
{
	/** Transaction client shared with personal-memory operation and task admission. */
	private readonly transaction: Prisma.TransactionClient;

	/** Binds source checks to the transaction that will save the operation. */
	public constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Checks current Read authority and exact encrypted payload coordinates without loading plaintext. */
	public async revalidate(caller: ConversationCaller, source: PersonalMemoryOperationMessageSource): Promise<boolean>
	{
		if (source.messagePosition < 1n || source.authorPrincipalId !== caller.principalId)
			return false;
		const repository = new PrismaConversationHistoryRepository(this.transaction);
		const projection = await repository.authorizeRead(caller, source.conversationId);
		if (projection === null || source.messagePosition < projection.visibleFromPosition)
			return false;
		const payloads = await repository.readPayloads(caller, source.conversationId, [source.payloadRef]);
		if (payloads.length !== 1)
			return false;
		const payload = payloads[0]!;
		return payload.coordinates.siloId === caller.siloId
			&& payload.coordinates.conversationId === source.conversationId
			&& payload.coordinates.payloadRef === source.payloadRef
			&& payload.coordinates.authorSubject === caller.subjectId
			&& payload.ciphertextDigest === source.ciphertextDigest;
	}
}
