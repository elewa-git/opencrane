import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

import type { ConversationPrivatePayloadCipher } from "../conversation-private-payload.types";
import type { ConversationComputerCredentialIssuer, ConversationComputerRawCredentialAuthority } from "../conversation-computer-turn.types";

/** Keeps one encrypted attempt key durable across bootstrap response loss and process restart. */
export class PrismaConversationComputerCredentialRepository implements ConversationComputerCredentialIssuer
{
	public constructor(private readonly prisma: Prisma.TransactionClient, private readonly cipher: ConversationPrivatePayloadCipher, private readonly raw: ConversationComputerRawCredentialAuthority, private readonly siloId: string) {}

	/** Return the current unexpired key or replace expired custody after revocation. */
	public async issueOrRotate(input: Parameters<ConversationComputerCredentialIssuer["issueOrRotate"]>[0])
	{
		if (input.siloId !== this.siloId)
			throw new Error("Conversation computer credential crossed its configured silo");
		const lease = await this.prisma.conversationComputerActiveLease.updateMany({ where: { siloId: input.siloId, conversationId: input.conversationId, computerId: input.computerId, leaseId: input.leaseId, leaseGeneration: input.leaseGeneration, expiresAt: { gt: new Date() } }, data: { updatedAt: new Date() } });
		if (lease.count !== 1)
			throw new Error("Conversation computer credential requires the current active lease");
		let existing = await this.prisma.conversationComputerAttemptCredential.findUnique({ where: { bootstrapId: input.bootstrapId } });
		if (existing !== null && (existing.siloId !== input.siloId || existing.conversationId !== input.conversationId || existing.keyAlias !== input.keyAlias || existing.modelAlias !== input.modelAlias))
			throw new Error("Conversation computer credential retry changed its frozen coordinates");
		if (existing?.state === "ready" && existing.expiresAt.getTime() > Date.now())
		{
			const key = this._decrypt(existing);
			return { key, credentialDigest: existing.credentialDigest! };
		}
		const fence = randomUUID();
		const claimExpiresAt = new Date(Date.now() + 30_000);
		if (existing === null)
		{
			try
			{
				existing = await this.prisma.conversationComputerAttemptCredential.create({ data: { bootstrapId: input.bootstrapId, keyAlias: input.keyAlias, modelAlias: input.modelAlias, siloId: input.siloId, conversationId: input.conversationId, state: "pending", claimFence: fence, claimExpiresAt, expiresAt: new Date(0) } });
			}
			catch
			{
				throw new Error("Conversation computer credential issuance is already in progress");
			}
		}
		else
		{
			if (existing.state === "pending" && existing.claimExpiresAt.getTime() > Date.now())
				throw new Error("Conversation computer credential issuance is already in progress");
			const claimed = await this.prisma.conversationComputerAttemptCredential.updateMany({ where: { bootstrapId: input.bootstrapId, claimFence: existing.claimFence }, data: { state: "pending", claimFence: fence, claimExpiresAt } });
			if (claimed.count !== 1)
				throw new Error("Conversation computer credential issuance lost its claim");
			if (existing.state === "ready")
				await this.raw.revoke({ keyAlias: existing.keyAlias, key: this._decrypt(existing) });
		}
		const minted = await this.raw.issue(input);
		const coordinates = _Coordinates(input.siloId, input.conversationId, input.bootstrapId);
		const encrypted = this.cipher.encrypt(minted.key, coordinates);
		const credentialDigest = `sha256:${createHash("sha256").update(minted.key).digest("hex")}`;
		const stored = await this.prisma.conversationComputerAttemptCredential.updateMany({ where: { bootstrapId: input.bootstrapId, state: "pending", claimFence: fence }, data: { state: "ready", keyId: encrypted.keyId, nonce: Buffer.from(encrypted.nonce), authTag: Buffer.from(encrypted.authTag), ciphertext: Buffer.from(encrypted.ciphertext), ciphertextDigest: encrypted.ciphertextDigest, credentialDigest, expiresAt: new Date(Date.now() + input.expirySeconds * 1_000) } });
		if (stored.count !== 1)
		{
			await this.raw.revoke({ keyAlias: input.keyAlias, key: minted.key });
			throw new Error("Conversation computer credential lost custody before persistence");
		}
		return { key: minted.key, credentialDigest };
	}

	/** Revoke the current raw key before deleting encrypted retry custody. */
	public async revoke(bootstrapId: string): Promise<void>
	{
		const existing = await this.prisma.conversationComputerAttemptCredential.findUnique({ where: { bootstrapId } });
		if (existing === null)
			return;
		if (existing.state !== "ready")
			return;
		const fence = randomUUID();
		const claimed = await this.prisma.conversationComputerAttemptCredential.updateMany({ where: { bootstrapId, state: "ready", claimFence: existing.claimFence }, data: { state: "revoking", claimFence: fence } });
		if (claimed.count !== 1)
			return;
		try
		{
			await this.raw.revoke({ keyAlias: existing.keyAlias, key: this._decrypt(existing) });
		}
		catch (error)
		{
			await this.prisma.conversationComputerAttemptCredential.updateMany({ where: { bootstrapId, state: "revoking", claimFence: fence }, data: { state: "ready", claimFence: existing.claimFence } });
			throw error;
		}
		await this.prisma.conversationComputerAttemptCredential.deleteMany({ where: { bootstrapId, state: "revoking", claimFence: fence } });
	}

	private _decrypt(row: { readonly bootstrapId: string; readonly siloId: string; readonly conversationId: string; readonly keyId: string | null; readonly nonce: Uint8Array | null; readonly authTag: Uint8Array | null; readonly ciphertext: Uint8Array | null; readonly ciphertextDigest: string | null; readonly credentialDigest: string | null }): string
	{
		if (row.keyId === null || row.nonce === null || row.authTag === null || row.ciphertext === null || row.ciphertextDigest === null || row.credentialDigest === null)
			throw new Error("Conversation computer credential is not ready");
		const key = this.cipher.decrypt({ keyId: row.keyId, nonce: row.nonce, authTag: row.authTag, ciphertext: row.ciphertext, ciphertextDigest: row.ciphertextDigest }, _Coordinates(row.siloId, row.conversationId, row.bootstrapId));
		if (`sha256:${createHash("sha256").update(key).digest("hex")}` !== row.credentialDigest)
			throw new Error("Conversation computer attempt credential digest does not match");
		return key;
	}
}

/** Opens serializable transactions around encrypted attempt-credential custody changes. */
export class PrismaConversationComputerCredentialUnitOfWork implements ConversationComputerCredentialIssuer
{
	public constructor(private readonly prisma: PrismaClient, private readonly cipher: ConversationPrivatePayloadCipher, private readonly raw: ConversationComputerRawCredentialAuthority, private readonly siloId: string) {}

	/** Issue or rotate one credential while serializing its custody record. */
	public issueOrRotate(input: Parameters<ConversationComputerCredentialIssuer["issueOrRotate"]>[0])
	{
		return this._Run(repository => repository.issueOrRotate(input));
	}

	/** Revoke one credential while serializing its custody record. */
	public revoke(bootstrapId: string): Promise<void>
	{
		return this._Run(repository => repository.revoke(bootstrapId));
	}

	private _Run<TResult>(operation: (repository: PrismaConversationComputerCredentialRepository) => Promise<TResult>): Promise<TResult>
	{
		const cipher = this.cipher;
		const raw = this.raw;
		const siloId = this.siloId;
		return this.prisma.$transaction(async function _Run(transaction: Prisma.TransactionClient)
		{
			return await operation(new PrismaConversationComputerCredentialRepository(transaction, cipher, raw, siloId));
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}

function _Coordinates(siloId: string, conversationId: string, bootstrapId: string)
{
	return { siloId, conversationId, payloadRef: bootstrapId, authorSubject: "conversation-computer" };
}
