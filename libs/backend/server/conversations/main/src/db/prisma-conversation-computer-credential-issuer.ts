import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

import type { ConversationPrivatePayloadCipher } from "../conversation-private-payload.types";
import type { ConversationComputerCredentialIssueCommand, ConversationComputerCredentialIssuer, ConversationComputerCredentialReceipt, ConversationComputerCredentialReuseCommand, ConversationComputerRawCredentialAuthority } from "../conversation-computer-turn.types";
import { ConversationComputerCredentialStates, type ConversationComputerCredentialCustody, type ConversationComputerCredentialPersistenceRepository } from "./conversation-computer-credential-persistence.types";
import { _AssertFencedRowCount } from "./prisma-fenced-write";

type _Input = ConversationComputerCredentialIssueCommand;
type _Custody = ConversationComputerCredentialCustody;

/** Owns transaction-bound claims and encrypted custody without provider I/O. */
export class PrismaConversationComputerCredentialRepository implements ConversationComputerCredentialPersistenceRepository
{
	public constructor(private readonly prisma: Prisma.TransactionClient, private readonly siloId: string) {}

	/** Claim the first mint or recover usable custody; retained failure states never become a new claim. */
	public async prepare(input: _Input): Promise<{ readonly outcome: "claim"; readonly fence: string } | { readonly outcome: "alias_cleanup" | "custody" | "ready" | "expired"; readonly row: _Custody }>
	{
		this._AssertSilo(input);
		await this._TouchActiveLease(input, "Conversation computer credential requires the current active lease");
		const existing = await this._ReadCoordinates(input);
		if (existing?.state === ConversationComputerCredentialStates.Revoked)
			throw new Error("Conversation computer credential attempt was already revoked");
		if (existing?.state === ConversationComputerCredentialStates.Revoking)
			return { outcome: "expired", row: existing };
		if (existing !== null && (existing.state === ConversationComputerCredentialStates.Ready || existing.state === ConversationComputerCredentialStates.Custodied))
		{
			if (!_HasCustody(existing))
				throw new Error("Conversation computer credential is missing encrypted custody");
			if (existing.expiresAt.getTime() <= Date.now() || existing.expiresAt.getTime() > Date.parse(input.notAfter))
				return { outcome: "expired", row: existing };
			return { outcome: existing.state === ConversationComputerCredentialStates.Ready ? "ready" : "custody", row: existing };
		}
		if (existing?.state === ConversationComputerCredentialStates.AliasCleanup || (existing?.state === ConversationComputerCredentialStates.Pending && existing.claimExpiresAt.getTime() <= Date.now()))
			return { outcome: "alias_cleanup", row: existing };
		if (existing?.state === ConversationComputerCredentialStates.Pending && existing.claimExpiresAt.getTime() > Date.now())
			throw new Error("Conversation computer credential issuance is already in progress");
		const fence = randomUUID();
		const claimExpiresAt = new Date(Date.now() + 30_000);
		if (existing === null)
		{
			try
			{
				await this.prisma.conversationComputerAttemptCredential.create({ data: { bootstrapId: input.bootstrapId, keyAlias: input.keyAlias, modelAlias: input.modelAlias, siloId: input.computer.siloId, conversationId: input.computer.conversationId, state: ConversationComputerCredentialStates.Pending, claimFence: fence, claimExpiresAt, expiresAt: new Date(0) } });
			}
			catch
			{
				throw new Error("Conversation computer credential issuance is already in progress");
			}
		}
		else
			throw new Error("Conversation computer credential has an unsupported custody state");
		return { outcome: "claim", fence };
	}

	/** Recheck current lease and the saved receipt without creating or promoting custody. */
	public async reuseExact(input: ConversationComputerCredentialReuseCommand): Promise<_Custody>
	{
		this._AssertSilo(input);
		await this._TouchActiveLease(input, "Conversation computer credential reuse requires the current active lease");
		const row = await this._ReadCoordinates(input);
		if (row === null)
			throw new Error("Conversation computer credential custody is missing");
		if (row.state !== ConversationComputerCredentialStates.Ready || !_HasCustody(row))
			throw new Error("Conversation computer credential custody is not ready for reuse");
		if (row.expiresAt.getTime() <= Date.now() || row.expiresAt.getTime() > Date.parse(input.notAfter))
			throw new Error("Conversation computer credential reuse exceeds its actual or current authority expiry");
		if (row.credentialDigest !== input.expectedCredentialDigest || row.expiresAt.toISOString() !== input.expectedExpiresAt)
			throw new Error("Conversation computer credential reuse changed its saved receipt");
		return row;
	}

	/** Commit encrypted provider-key custody before caller-visible finalization. */
	public async storeCustody(input: _Input, fence: string, encrypted: ReturnType<ConversationPrivatePayloadCipher["encrypt"]>, credentialDigest: string, expiresAt: string): Promise<void>
	{
		this._AssertSilo(input);
		_AssertFencedRowCount(await this.prisma.conversationComputerAttemptCredential.updateMany({ where: { bootstrapId: input.bootstrapId, state: ConversationComputerCredentialStates.Pending, claimFence: fence }, data: { state: ConversationComputerCredentialStates.Custodied, keyId: encrypted.keyId, nonce: Buffer.from(encrypted.nonce), authTag: Buffer.from(encrypted.authTag), ciphertext: Buffer.from(encrypted.ciphertext), ciphertextDigest: encrypted.ciphertextDigest, credentialDigest, expiresAt: new Date(expiresAt) } }), 1, "Conversation computer credential lost custody before persistence");
	}

	/** Promote exact committed custody to ready state. */
	public async finalize(input: _Input, fence: string): Promise<void>
	{
		this._AssertSilo(input);
		await this._TouchActiveLease(input, "Conversation computer credential finalization requires the current active lease");
		_AssertFencedRowCount(await this.prisma.conversationComputerAttemptCredential.updateMany({ where: { bootstrapId: input.bootstrapId, siloId: input.computer.siloId, conversationId: input.computer.conversationId, keyAlias: input.keyAlias, modelAlias: input.modelAlias, state: ConversationComputerCredentialStates.Custodied, claimFence: fence, expiresAt: { gt: new Date(), lte: new Date(input.notAfter) } }, data: { state: ConversationComputerCredentialStates.Ready } }), 1, "Conversation computer credential custody could not be finalized");
	}

	/** Mark a pre-custody mint for deterministic alias cleanup on every later retry. */
	public async markAliasCleanup(bootstrapId: string, fence: string): Promise<_Custody | null>
	{
		const marked = await this.prisma.conversationComputerAttemptCredential.updateMany({ where: { bootstrapId, state: ConversationComputerCredentialStates.Pending, claimFence: fence }, data: { state: ConversationComputerCredentialStates.AliasCleanup, claimExpiresAt: new Date(0) } });
		if (marked.count !== 1)
			return null;
		return await this.prisma.conversationComputerAttemptCredential.findUnique({ where: { bootstrapId } }) as _Custody | null;
	}

	/** Clear revoked secrets while retaining the attempt marker so no later caller can mint again. */
	public async finishRevocation(bootstrapId: string, fence: string): Promise<void>
	{
		await this.prisma.conversationComputerAttemptCredential.updateMany({ where: { bootstrapId, claimFence: fence, state: { in: [ConversationComputerCredentialStates.Revoking, ConversationComputerCredentialStates.AliasCleanup] } }, data: { state: ConversationComputerCredentialStates.Revoked, keyId: null, nonce: null, authTag: null, ciphertext: null, ciphertextDigest: null, credentialDigest: null, claimExpiresAt: new Date(0) } });
	}

	/** Fence one durable key for idempotent revocation. */
	public async claimRevocation(bootstrapId: string): Promise<_Custody | null>
	{
		const existing = await this.prisma.conversationComputerAttemptCredential.findUnique({ where: { bootstrapId } }) as _Custody | null;
		if (existing === null || existing.state === ConversationComputerCredentialStates.Revoked)
			return null;
		if (!Object.values(ConversationComputerCredentialStates).includes(existing.state))
			throw new Error("Conversation computer credential has an unsupported custody state");
		if (existing.state === ConversationComputerCredentialStates.Pending && existing.claimExpiresAt.getTime() > Date.now())
			throw new Error("Conversation computer credential issuance is still in progress");
		const fence = randomUUID();
		const claimed = await this.prisma.conversationComputerAttemptCredential.updateMany({ where: { bootstrapId, claimFence: existing.claimFence }, data: { state: ConversationComputerCredentialStates.Revoking, claimFence: fence } });
		return claimed.count === 1 ? { ...existing, state: ConversationComputerCredentialStates.Revoking, claimFence: fence } : null;
	}

	/** Load the bootstrap's custody and reject changed server-owned identity or model coordinates. */
	private async _ReadCoordinates(input: _Input): Promise<_Custody | null>
	{
		const row = await this.prisma.conversationComputerAttemptCredential.findUnique({ where: { bootstrapId: input.bootstrapId } }) as _Custody | null;
		if (row !== null && (row.siloId !== input.computer.siloId || row.conversationId !== input.computer.conversationId || row.keyAlias !== input.keyAlias || row.modelAlias !== input.modelAlias))
			throw new Error("Conversation computer credential retry changed its frozen coordinates");
		return row;
	}

	/** Touch the active-lease row for this exact computer and lease so the transaction fails if lifecycle cleared or replaced it. */
	private async _TouchActiveLease(input: _Input, reason: string): Promise<void>
	{
		const { siloId, conversationId, computerId } = input.computer;
		const touched = await this.prisma.conversationComputerActiveLease.updateMany({ where: { siloId, conversationId, computerId, leaseId: input.lease.leaseId, leaseGeneration: input.lease.leaseGeneration, expiresAt: { gte: new Date(input.notAfter), gt: new Date() } }, data: { updatedAt: new Date() } });
		_AssertFencedRowCount(touched, 1, reason);
	}

	private _AssertSilo(input: _Input): void
	{
		if (input.computer.siloId !== this.siloId)
			throw new Error("Conversation computer credential crossed its configured silo");
	}
}

/** Coordinates durable custody transactions around provider key operations. */
export class PrismaConversationComputerCredentialUnitOfWork implements ConversationComputerCredentialIssuer
{
	public constructor(private readonly prisma: PrismaClient, private readonly cipher: ConversationPrivatePayloadCipher, private readonly raw: ConversationComputerRawCredentialAuthority, private readonly siloId: string) {}

	/** Return the first key after custody and promotion; cleanup never restarts issuance for this attempt. */
	public async issueOnce(command: _Input): Promise<ConversationComputerCredentialReceipt>
	{
		const input = _BoundInput(command);
		const prepared = await this._Run(repository => repository.prepare(input));
		if (prepared.outcome === "ready")
			return this._Unwrap(prepared.row);
		if (prepared.outcome === "expired")
		{
			await this.revoke(input.bootstrapId);
			throw new Error("Conversation computer credential cannot replace expired or revoking custody");
		}
		if (prepared.outcome === "alias_cleanup")
		{
			await this.revoke(input.bootstrapId);
			throw new Error("Conversation computer credential cannot replace uncertain issuance");
		}
		if (prepared.outcome === "custody")
		{
			await this._FinalizeOrRetain(input, prepared.row);
			return this._Unwrap(prepared.row);
		}
		if (prepared.outcome !== "claim")
			throw new Error("Conversation computer credential preparation returned an invalid outcome");
		const minted = await this.raw.issue(_BoundInput(input));
		const expiresAt = minted.expiresAt;
		let encrypted: ReturnType<ConversationPrivatePayloadCipher["encrypt"]>;
		try
		{
			if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now() || Date.parse(expiresAt) > Date.parse(input.notAfter))
				throw new Error("Conversation computer provider key exceeds its current authority expiry");
			encrypted = this.cipher.encrypt(minted.key, _Coordinates(input.computer.siloId, input.computer.conversationId, input.bootstrapId));
		}
		catch (error)
		{
			await this._RetainAliasCleanup(input.bootstrapId, prepared.fence, input.keyAlias, minted.key);
			throw error;
		}
		const credentialDigest = `sha256:${createHash("sha256").update(minted.key).digest("hex")}`;
		try
		{
			await this._Run(repository => repository.storeCustody(input, prepared.fence, encrypted, credentialDigest, expiresAt));
		}
		catch (error)
		{
			await this._RetainAliasCleanup(input.bootstrapId, prepared.fence, input.keyAlias, minted.key);
			throw error;
		}
		const custody: _Custody = { bootstrapId: input.bootstrapId, siloId: input.computer.siloId, conversationId: input.computer.conversationId, keyAlias: input.keyAlias, modelAlias: input.modelAlias, state: ConversationComputerCredentialStates.Custodied, claimFence: prepared.fence, claimExpiresAt: new Date(0), expiresAt: new Date(expiresAt), keyId: encrypted.keyId, nonce: encrypted.nonce, authTag: encrypted.authTag, ciphertext: encrypted.ciphertext, ciphertextDigest: encrypted.ciphertextDigest, credentialDigest };
		await this._FinalizeOrRetain(input, custody);
		return { key: minted.key, credentialDigest, expiresAt: custody.expiresAt.toISOString() };
	}

	/** Return the first key's receipt without issuing, rotating or renewing a credential. */
	public async reuseExact(input: ConversationComputerCredentialReuseCommand): Promise<ConversationComputerCredentialReceipt>
	{
		if (!Number.isFinite(Date.parse(input.notAfter)) || Date.parse(input.notAfter) <= Date.now())
			throw new Error("Conversation computer credential reuse requires unexpired authority");
		const row = await this._Run(repository => repository.reuseExact(input));
		return this._Unwrap(row);
	}

	/** Revoke the provider key and clear secret custody, retaining the spent attempt marker. */
	public async revoke(bootstrapId: string): Promise<void>
	{
		const custody = await this._Run(repository => repository.claimRevocation(bootstrapId));
		if (custody !== null)
			await this._RevokeCustody(custody);
	}

	private async _FinalizeOrRetain(input: _Input, custody: _Custody): Promise<void>
	{
		try
		{
			await this._Run(repository => repository.finalize(input, custody.claimFence));
		}
		catch (finalizeError)
		{
			try
			{
				const cleanup = await this._Run(repository => repository.claimRevocation(custody.bootstrapId));
				if (cleanup !== null)
					await this._RevokeCustody(cleanup);
			}
			catch
			{
				// A committed encrypted row retains the raw key for a later cleanup retry.
			}
			throw finalizeError;
		}
	}

	private async _RetainAliasCleanup(bootstrapId: string, fence: string, keyAlias: string, key: string): Promise<void>
	{
		let cleanup: _Custody | null = null;
		try
		{
			cleanup = await this._Run(repository => repository.markAliasCleanup(bootstrapId, fence));
		}
		catch
		{
			// Raw-key cleanup remains possible even when the durable cleanup transition is unavailable.
		}
		try
		{
			await this.raw.revoke({ keyAlias, key });
			if (cleanup !== null)
				await this._Run(repository => repository.finishRevocation(bootstrapId, cleanup.claimFence));
		}
		catch
		{
			// The durable alias-cleanup state lets a later retry revoke without the raw key.
		}
	}

	private async _RevokeCustody(custody: _Custody): Promise<void>
	{
		if (_HasCustody(custody))
			await this.raw.revoke({ keyAlias: custody.keyAlias, key: this._Unwrap(custody).key });
		else
			await this.raw.revokeByAlias({ keyAlias: custody.keyAlias });
		await this._Run(repository => repository.finishRevocation(custody.bootstrapId, custody.claimFence));
	}

	/** Verify the saved key digest; callers decide expiry because cleanup must also decrypt expired keys. */
	private _Unwrap(row: _Custody): ConversationComputerCredentialReceipt
	{
		if (!_HasCustody(row))
			throw new Error("Conversation computer credential is not in durable custody");
		const key = this.cipher.decrypt({ keyId: row.keyId, nonce: row.nonce, authTag: row.authTag, ciphertext: row.ciphertext, ciphertextDigest: row.ciphertextDigest }, _Coordinates(row.siloId, row.conversationId, row.bootstrapId));
		if (`sha256:${createHash("sha256").update(key).digest("hex")}` !== row.credentialDigest)
			throw new Error("Conversation computer attempt credential digest does not match");
		return { key, credentialDigest: row.credentialDigest, expiresAt: row.expiresAt.toISOString() };
	}

	private _Run<TResult>(operation: (repository: PrismaConversationComputerCredentialRepository) => Promise<TResult>): Promise<TResult>
	{
		const siloId = this.siloId;
		return this.prisma.$transaction(async function _Run(transaction: Prisma.TransactionClient)
		{
			return await operation(new PrismaConversationComputerCredentialRepository(transaction, siloId));
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}

function _HasCustody(row: _Custody): row is _Custody & { readonly keyId: string; readonly nonce: Uint8Array; readonly authTag: Uint8Array; readonly ciphertext: Uint8Array; readonly ciphertextDigest: string; readonly credentialDigest: string }
{
	return row.keyId !== null && row.nonce !== null && row.authTag !== null && row.ciphertext !== null && row.ciphertextDigest !== null && row.credentialDigest !== null;
}

function _Coordinates(siloId: string, conversationId: string, bootstrapId: string)
{
	return { siloId, conversationId, payloadRef: bootstrapId, authorSubject: "conversation-computer" };
}

/** Shortens each attempt to the remaining absolute admission bound before provider work begins. */
function _BoundInput(input: _Input): _Input
{
	const now = Date.now();
	const remaining = Math.floor((Date.parse(input.notAfter) - now) / 1_000);
	if (!Number.isSafeInteger(input.expirySeconds) || input.expirySeconds < 1 || !Number.isFinite(remaining) || remaining < 1)
		throw new Error("Conversation computer credential requires unexpired authority");
	const expirySeconds = Math.min(input.expirySeconds, remaining);
	return { ...input, expirySeconds, notAfter: new Date(now + expirySeconds * 1_000).toISOString() };
}
