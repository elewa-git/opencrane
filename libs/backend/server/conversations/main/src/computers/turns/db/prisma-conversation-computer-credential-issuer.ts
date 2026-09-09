import { Prisma, type PrismaClient } from "@prisma/client";

import type { ConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";
import type { ConversationComputerCredentialIssueCommand, ConversationComputerCredentialIssuer, ConversationComputerCredentialReceipt, ConversationComputerCredentialReuseCommand, ConversationComputerRawCredentialAuthority } from "../conversation-computer-turn.types";
import { ConversationComputerCredentialCleanup } from "../credentials/conversation-computer-credential-cleanup";
import { ConversationComputerCredentialIssuance } from "../credentials/conversation-computer-credential-issuance";
import { ConversationComputerCredentialReceiptCodec } from "../credentials/conversation-computer-credential-receipt";
import { PrismaConversationComputerCredentialRepository } from "../credentials/prisma-conversation-computer-credential-repository";
import type { ConversationComputerCredentialTransactions } from "../credentials/conversation-computer-credential.types";
import type { ConversationComputerCredentialPersistenceRepository } from "./conversation-computer-credential-persistence.types";

/**
 * Owns Serializable credential transactions around provider operations. Each callback receives a
 * repository built from that transaction's client; provider issuance and cleanup run after commit.
 */
export class PrismaConversationComputerCredentialUnitOfWork implements ConversationComputerCredentialIssuer, ConversationComputerCredentialTransactions
{
	/** Coordinates issuance and recovery without owning a database client. */
	private readonly _issuance: ConversationComputerCredentialIssuance;
	/** Retains failed cleanup work without permitting a replacement key. */
	private readonly _cleanup: ConversationComputerCredentialCleanup;

	/** Composes credential behavior around this unit of work's transaction boundary. */
	public constructor(private readonly prisma: PrismaClient, cipher: ConversationPrivatePayloadCipher, raw: ConversationComputerRawCredentialAuthority, private readonly siloId: string)
	{
		const receipts = new ConversationComputerCredentialReceiptCodec(cipher);
		this._cleanup = new ConversationComputerCredentialCleanup(this, raw, receipts);
		this._issuance = new ConversationComputerCredentialIssuance(this, raw, receipts, this._cleanup);
	}

	/** Returns the first key after custody commits; retries never replace a spent or uncertain attempt. */
	public issueOnce(command: ConversationComputerCredentialIssueCommand): Promise<ConversationComputerCredentialReceipt>
	{
		return this._issuance.issueOnce(command);
	}

	/** Returns the original receipt without minting, promoting or extending its authority. */
	public reuseExact(input: ConversationComputerCredentialReuseCommand): Promise<ConversationComputerCredentialReceipt>
	{
		return this._issuance.reuseExact(input);
	}

	/** Revokes the original key before clearing custody and retaining the spent-attempt marker. */
	public revoke(bootstrapId: string): Promise<void>
	{
		return this._cleanup.revoke(bootstrapId);
	}

	/** Commits a repository operation in isolation; its callback must never call a provider. */
	public run<TResult>(operation: (repository: ConversationComputerCredentialPersistenceRepository) => Promise<TResult>): Promise<TResult>
	{
		const siloId = this.siloId;
		return this.prisma.$transaction(async function _Run(transaction: Prisma.TransactionClient)
		{
			const repository = new PrismaConversationComputerCredentialRepository(transaction, siloId);
			return await operation(repository);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}
