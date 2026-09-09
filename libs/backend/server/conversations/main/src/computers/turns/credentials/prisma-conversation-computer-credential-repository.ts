import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

import type { ConversationComputerCredentialIssueCommand, ConversationComputerCredentialReuseCommand } from "../conversation-computer-turn.types";
import type { ConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";
import { ConversationComputerCredentialPreparationOutcomes, ConversationComputerCredentialStates, type ConversationComputerCredentialCustody, type ConversationComputerCredentialPersistenceRepository, type ConversationComputerCredentialPreparation } from "../db/conversation-computer-credential-persistence.types";
import { _AssertFencedRowCount } from "../db/prisma-fenced-write";
import { _AssertCredentialReusable, _CredentialRequiresRevocation, _PrepareExistingCredential } from "./conversation-computer-credential-state";

/** Owns transaction-bound claims and encrypted custody without provider I/O. */
export class PrismaConversationComputerCredentialRepository implements ConversationComputerCredentialPersistenceRepository
{
	/** Receives the transaction client and configured silo from the unit of work. */
	public constructor(private readonly prisma: Prisma.TransactionClient, private readonly siloId: string) {}

	/** Claim the first mint or recover usable custody; retained failure states never become a new claim. */
	public async prepare(input: ConversationComputerCredentialIssueCommand): Promise<ConversationComputerCredentialPreparation>
	{
		this._AssertSilo(input);
		await this._TouchActiveLease(input, "Conversation computer credential requires the current active lease");
		const existing = await this._ReadCoordinates(input);
		if (existing !== null)
			return _PrepareExistingCredential(existing, input);
		const fence = randomUUID();
		const claimExpiresAt = new Date(Date.now() + 30_000);
		try
		{
			await this.prisma.conversationComputerAttemptCredential.create({ data: { bootstrapId: input.bootstrapId, keyAlias: input.keyAlias, modelAlias: input.modelAlias, siloId: input.computer.siloId, conversationId: input.computer.conversationId, state: ConversationComputerCredentialStates.Pending, claimFence: fence, claimExpiresAt, expiresAt: new Date(0) } });
		}
		catch
		{
			throw new Error("Conversation computer credential issuance is already in progress");
		}
		return { outcome: ConversationComputerCredentialPreparationOutcomes.Claim, fence };
	}

	/** Recheck current lease and the saved receipt without creating or promoting custody. */
	public async reuseExact(input: ConversationComputerCredentialReuseCommand): Promise<ConversationComputerCredentialCustody>
	{
		this._AssertSilo(input);
		await this._TouchActiveLease(input, "Conversation computer credential reuse requires the current active lease");
		const row = await this._ReadCoordinates(input);
		if (row === null)
			throw new Error("Conversation computer credential custody is missing");
		_AssertCredentialReusable(row);
		if (row.expiresAt.getTime() <= Date.now() || row.expiresAt.getTime() > Date.parse(input.notAfter))
			throw new Error("Conversation computer credential reuse exceeds its actual or current authority expiry");
		if (row.credentialDigest !== input.expectedCredentialDigest || row.expiresAt.toISOString() !== input.expectedExpiresAt)
			throw new Error("Conversation computer credential reuse changed its saved receipt");
		return row;
	}

	/** Commit encrypted provider-key custody before caller-visible finalization. */
	public async storeCustody(input: ConversationComputerCredentialIssueCommand, fence: string, encrypted: ReturnType<ConversationPrivatePayloadCipher["encrypt"]>, credentialDigest: string, expiresAt: string): Promise<void>
	{
		this._AssertSilo(input);
		_AssertFencedRowCount(await this.prisma.conversationComputerAttemptCredential.updateMany({ where: { bootstrapId: input.bootstrapId, state: ConversationComputerCredentialStates.Pending, claimFence: fence }, data: { state: ConversationComputerCredentialStates.Custodied, keyId: encrypted.keyId, nonce: Buffer.from(encrypted.nonce), authTag: Buffer.from(encrypted.authTag), ciphertext: Buffer.from(encrypted.ciphertext), ciphertextDigest: encrypted.ciphertextDigest, credentialDigest, expiresAt: new Date(expiresAt) } }), 1, "Conversation computer credential lost custody before persistence");
	}

	/** Promote exact committed custody to ready state. */
	public async finalize(input: ConversationComputerCredentialIssueCommand, fence: string): Promise<void>
	{
		this._AssertSilo(input);
		await this._TouchActiveLease(input, "Conversation computer credential finalization requires the current active lease");
		_AssertFencedRowCount(await this.prisma.conversationComputerAttemptCredential.updateMany({ where: { bootstrapId: input.bootstrapId, siloId: input.computer.siloId, conversationId: input.computer.conversationId, keyAlias: input.keyAlias, modelAlias: input.modelAlias, state: ConversationComputerCredentialStates.Custodied, claimFence: fence, expiresAt: { gt: new Date(), lte: new Date(input.notAfter) } }, data: { state: ConversationComputerCredentialStates.Ready } }), 1, "Conversation computer credential custody could not be finalized");
	}

	/** Mark a pre-custody mint for deterministic alias cleanup on every later retry. */
	public async markAliasCleanup(bootstrapId: string, fence: string): Promise<ConversationComputerCredentialCustody | null>
	{
		const marked = await this.prisma.conversationComputerAttemptCredential.updateMany({ where: { bootstrapId, state: ConversationComputerCredentialStates.Pending, claimFence: fence }, data: { state: ConversationComputerCredentialStates.AliasCleanup, claimExpiresAt: new Date(0) } });
		if (marked.count !== 1)
			return null;
		return await this.prisma.conversationComputerAttemptCredential.findUnique({ where: { bootstrapId } }) as ConversationComputerCredentialCustody | null;
	}

	/** Clear revoked secrets while retaining the attempt marker so no later caller can mint again. */
	public async finishRevocation(bootstrapId: string, fence: string): Promise<void>
	{
		await this.prisma.conversationComputerAttemptCredential.updateMany({ where: { bootstrapId, claimFence: fence, state: { in: [ConversationComputerCredentialStates.Revoking, ConversationComputerCredentialStates.AliasCleanup] } }, data: { state: ConversationComputerCredentialStates.Revoked, keyId: null, nonce: null, authTag: null, ciphertext: null, ciphertextDigest: null, credentialDigest: null, claimExpiresAt: new Date(0) } });
	}

	/** Fence one durable key for idempotent revocation. */
	public async claimRevocation(bootstrapId: string): Promise<ConversationComputerCredentialCustody | null>
	{
		const existing = await this.prisma.conversationComputerAttemptCredential.findUnique({ where: { bootstrapId } }) as ConversationComputerCredentialCustody | null;
		if (existing === null || !_CredentialRequiresRevocation(existing))
			return null;
		const fence = randomUUID();
		const claimed = await this.prisma.conversationComputerAttemptCredential.updateMany({ where: { bootstrapId, claimFence: existing.claimFence }, data: { state: ConversationComputerCredentialStates.Revoking, claimFence: fence } });
		return claimed.count === 1 ? { ...existing, state: ConversationComputerCredentialStates.Revoking, claimFence: fence } : null;
	}

	/** Load the bootstrap's custody and reject changed server-owned identity or model coordinates. */
	private async _ReadCoordinates(input: ConversationComputerCredentialIssueCommand): Promise<ConversationComputerCredentialCustody | null>
	{
		const row = await this.prisma.conversationComputerAttemptCredential.findUnique({ where: { bootstrapId: input.bootstrapId } }) as ConversationComputerCredentialCustody | null;
		if (row !== null && (row.siloId !== input.computer.siloId || row.conversationId !== input.computer.conversationId || row.keyAlias !== input.keyAlias || row.modelAlias !== input.modelAlias))
			throw new Error("Conversation computer credential retry changed its frozen coordinates");
		return row;
	}

	/** Touch the active-lease row for this exact computer and lease so the transaction fails if lifecycle cleared or replaced it. */
	private async _TouchActiveLease(input: ConversationComputerCredentialIssueCommand, reason: string): Promise<void>
	{
		const { siloId, conversationId, computerId } = input.computer;
		const touched = await this.prisma.conversationComputerActiveLease.updateMany({ where: { siloId, conversationId, computerId, leaseId: input.lease.leaseId, leaseGeneration: input.lease.leaseGeneration, expiresAt: { gte: new Date(input.notAfter), gt: new Date() } }, data: { updatedAt: new Date() } });
		_AssertFencedRowCount(touched, 1, reason);
	}

	/** Rejects cross-silo commands before touching any credential or lease row. */
	private _AssertSilo(input: ConversationComputerCredentialIssueCommand): void
	{
		if (input.computer.siloId !== this.siloId)
			throw new Error("Conversation computer credential crossed its configured silo");
	}
}
