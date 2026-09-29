import type { Prisma } from "@prisma/client";

import type { ConversationPromptMessageRead, ConversationPromptMessageSource, RoutineOccurrencePromptAdmissionQuery } from "@opencrane/backend/agents/execution/inputs";
import type { ConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";

import { _RoutineEventId } from "./routine-occurrence-history.mapper";
import type { RoutineOccurrencePromptHistoryReader } from "./routine-occurrence-prompt-history-reader";

/** Service subject authenticated into every routine instruction payload. */
const _ROUTINE_INSTRUCTION_AUTHOR = "opencrane";

/** Resolves only the encrypted first instruction admitted for one exact routine occurrence. */
export class PrismaRoutineOccurrencePromptMessageRepository implements ConversationPromptMessageSource
{
	/** Transaction that owns the admitted run and its exact private-payload read. */
	private readonly transaction: Prisma.TransactionClient;
	/** Checked history reader that binds every independently supplied routine coordinate. */
	private readonly history: Pick<RoutineOccurrencePromptHistoryReader, "readRecord">;
	/** Conversation-owned cipher that checks the saved authenticated coordinates. */
	private readonly cipher: ConversationPrivatePayloadCipher;
	/** Exact occurrence admitted for compilation. */
	private readonly query: RoutineOccurrencePromptAdmissionQuery;
	/** History revision admitted before this source was constructed. */
	private readonly admittedHistoryRevision: string;

	/** Creates a source that cannot move to another occurrence or later history revision. */
	public constructor(transaction: Prisma.TransactionClient, history: Pick<RoutineOccurrencePromptHistoryReader, "readRecord">, cipher: ConversationPrivatePayloadCipher, query: RoutineOccurrencePromptAdmissionQuery, admittedHistoryRevision: string)
	{
		this.transaction = transaction;
		this.history = history;
		this.cipher = cipher;
		this.query = query;
		this.admittedHistoryRevision = admittedHistoryRevision;
	}

	/** Decrypts the single service-attested instruction after every durable binding agrees. */
	public async load(messageIds: readonly string[]): Promise<readonly ConversationPromptMessageRead[]>
	{
		const messageId = _RoutineEventId("instruction", this.query.conversationId);
		if (this.admittedHistoryRevision !== "1" || messageIds.length !== 1 || messageIds[0] !== messageId)
		{
			throw new Error("Routine occurrence prompt selection does not match admitted history");
		}
		const record = await this.history.readRecord(this.query);
		if (record === null)
		{
			throw new Error("Routine occurrence prompt history is unavailable");
		}
		const payload = await this.transaction.conversationPrivatePayload.findUnique({ where: { id: record.payloadRef } });
		if (payload === null || payload.id !== record.payloadRef || payload.siloId !== record.siloId || payload.conversationId !== record.conversationId || payload.authorSubject !== _ROUTINE_INSTRUCTION_AUTHOR || payload.ciphertextDigest !== record.ciphertextDigest)
		{
			throw new Error("Routine occurrence prompt payload does not match checked history");
		}
		const encrypted = { keyId: payload.keyId, nonce: payload.nonce, authTag: payload.authTag, ciphertext: payload.ciphertext, ciphertextDigest: payload.ciphertextDigest };
		const coordinates = { siloId: this.query.siloId, conversationId: this.query.conversationId, payloadRef: record.payloadRef, authorSubject: _ROUTINE_INSTRUCTION_AUTHOR };
		const content = this.cipher.decrypt(encrypted, coordinates);
		return [{ messageId, message: { role: "user", content } }];
	}
}
