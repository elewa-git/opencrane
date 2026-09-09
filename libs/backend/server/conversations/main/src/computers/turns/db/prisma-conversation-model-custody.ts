import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { ___CanonicalizeJson, ___ParseAndValidateJson, type JsonValue } from "@opencrane/util";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import type { ConversationComputerModelCustody, ConversationComputerPrivateModelReference, ConversationComputerToolContinuation, ConversationComputerToolDeclaration } from "../conversation-computer-continuation.types";
import { _ConversationToolContinuationSchema, _ConversationToolDeclarationSchema } from "../conversation-computer-continuation.validator";
import type { FrozenConversationComputerTurn } from "../conversation-computer-turn.types";
import type { ConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";

/** Keeps accepted model content in the existing encrypted payload table without publishing a message. */
export class PrismaConversationModelCustodyRepository implements ConversationComputerModelCustody
{
	public constructor(private readonly transaction: Prisma.TransactionClient, private readonly cipher: ConversationPrivatePayloadCipher) {}

	/** Commit the model declaration before a tool-selected event can reference it. */
	public async storeDeclaration(turn: FrozenConversationComputerTurn, declaration: ConversationComputerToolDeclaration): Promise<ConversationComputerPrivateModelReference>
	{
		_AssertDeclaration(turn, _ConversationToolDeclarationSchema.parse(declaration));
		return this._Store(turn, "declaration", ___CanonicalizeJson(declaration as unknown as JsonValue));
	}

	/** Recover committed custody after a lost selection append; current tool authority is checked by the caller. */
	public async loadDeclaration(turn: FrozenConversationComputerTurn)
	{
		const saved = await this._Read(turn, "declaration");
		if (saved === null)
			return null;
		const declaration = ___ParseAndValidateJson(saved.text, "Conversation model declaration", value => _ConversationToolDeclarationSchema.parse(value));
		_AssertDeclaration(turn, declaration);
		return { declaration, reference: saved.reference };
	}

	/** Commit the exact assistant/tool pair before the second model request consumes the delivery. */
	public async storeContinuation(turn: FrozenConversationComputerTurn, continuation: ConversationComputerToolContinuation)
	{
		_AssertContinuation(turn, _ConversationToolContinuationSchema.parse(continuation));
		return this._Store(turn, "continuation", ___CanonicalizeJson(continuation as unknown as JsonValue));
	}

	/** Read only the exact ciphertext named by the saved second-request reservation. */
	public async loadContinuation(turn: FrozenConversationComputerTurn, reference: ConversationComputerPrivateModelReference)
	{
		const saved = await this._Read(turn, "continuation");
		if (saved === null || saved.reference.payloadRef !== reference.payloadRef || saved.reference.ciphertextDigest !== reference.ciphertextDigest)
			throw new Error("Conversation model continuation custody differs from its saved reference");
		const continuation = ___ParseAndValidateJson(saved.text, "Conversation model continuation", value => _ConversationToolContinuationSchema.parse(value));
		_AssertContinuation(turn, continuation);
		return continuation;
	}

	private async _Store(turn: FrozenConversationComputerTurn, domain: "declaration" | "continuation", text: string)
	{
		const existing = await this._Read(turn, domain);
		if (existing !== null)
		{
			if (existing.text !== text)
				throw new Error("Conversation model custody cannot replace saved content");
			return existing.reference;
		}
		const coordinates = _Coordinates(turn, domain);
		const encrypted = this.cipher.encrypt(text, coordinates);
		await this.transaction.conversationPrivatePayload.create({ data: { id: coordinates.payloadRef, siloId: coordinates.siloId, conversationId: coordinates.conversationId, authorSubject: coordinates.authorSubject, idempotencyKey: coordinates.payloadRef, keyId: encrypted.keyId, nonce: Buffer.from(encrypted.nonce), authTag: Buffer.from(encrypted.authTag), ciphertext: Buffer.from(encrypted.ciphertext), ciphertextDigest: encrypted.ciphertextDigest } });
		return { payloadRef: coordinates.payloadRef, ciphertextDigest: encrypted.ciphertextDigest };
	}

	private async _Read(turn: FrozenConversationComputerTurn, domain: "declaration" | "continuation")
	{
		const coordinates = _Coordinates(turn, domain);
		const row = await this.transaction.conversationPrivatePayload.findUnique({ where: { id: coordinates.payloadRef } });
		if (row === null)
			return null;
		if (row.siloId !== coordinates.siloId || row.conversationId !== coordinates.conversationId || row.authorSubject !== coordinates.authorSubject || row.idempotencyKey !== coordinates.payloadRef)
			throw new Error("Conversation model custody crossed its original coordinates");
		const text = this.cipher.decrypt({ keyId: row.keyId, nonce: row.nonce, authTag: row.authTag, ciphertext: row.ciphertext, ciphertextDigest: row.ciphertextDigest }, coordinates);
		return { text, reference: { payloadRef: row.id, ciphertextDigest: row.ciphertextDigest } };
	}
}

/** Opens only payload transactions; it cannot call a model, admit a tool or append participant history. */
export class PrismaConversationModelCustodyUnitOfWork implements ConversationComputerModelCustody
{
	public constructor(private readonly prisma: PrismaClient, private readonly cipher: ConversationPrivatePayloadCipher) {}

	public storeDeclaration(turn: FrozenConversationComputerTurn, declaration: ConversationComputerToolDeclaration)
	{
		return this._Run(repository => repository.storeDeclaration(turn, declaration));
	}
	public loadDeclaration(turn: FrozenConversationComputerTurn)
	{
		return this._Run(repository => repository.loadDeclaration(turn));
	}
	public storeContinuation(turn: FrozenConversationComputerTurn, continuation: ConversationComputerToolContinuation)
	{
		return this._Run(repository => repository.storeContinuation(turn, continuation));
	}
	public loadContinuation(turn: FrozenConversationComputerTurn, reference: ConversationComputerPrivateModelReference)
	{
		return this._Run(repository => repository.loadContinuation(turn, reference));
	}
	private _Run<T>(operation: (repository: PrismaConversationModelCustodyRepository) => Promise<T>)
	{
		const cipher = this.cipher;
		return ___RunInPrismaUnitOfWork(this.prisma, async function _Custody(transaction)
		{
			return operation(new PrismaConversationModelCustodyRepository(transaction, cipher));
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, operation: "conversation model custody", attemptLimit: 3 });
	}
}

/** Derives private payload identity independently of participant-output idempotency keys. */
function _Coordinates(turn: FrozenConversationComputerTurn, domain: "declaration" | "continuation")
{
	if (turn.modelReservation === null)
		throw new Error("Conversation model custody requires its original request reservation");
	const hex = createHash("sha256").update(JSON.stringify(["conversation-model-custody", domain, turn.bootstrapId, turn.modelReservation.invocationFence])).digest("hex");
	const payloadRef = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
	return { siloId: turn.siloId, conversationId: turn.binding.conversationId, payloadRef, authorSubject: turn.binding.agentIdentityId };
}

/** A saved acceptance time may precede recovery, but cannot exceed the original dispatch/key window. */
function _AssertDeclaration(turn: FrozenConversationComputerTurn, value: ConversationComputerToolDeclaration)
{
	if (turn.modelReservation === null || value.bootstrapId !== turn.bootstrapId || value.runId !== turn.compile.runId || value.attempt !== turn.compile.attempt || value.compiledInputDigest !== turn.compile.digest || value.modelInvocationFence !== turn.modelReservation.invocationFence
		|| value.acceptedAtEpochMs > Date.now() || value.acceptedAtEpochMs >= value.requestNotAfterEpochMs || value.requestNotAfterEpochMs > turn.modelReservation.dispatchDeadlineEpochMs || value.requestNotAfterEpochMs > Date.parse(value.credentialExpiresAt))
		throw new Error("Conversation model declaration crossed its original accepted response");
}

/** The pair keeps the original input anchor and selected encrypted declaration unchanged. */
function _AssertContinuation(turn: FrozenConversationComputerTurn, value: ConversationComputerToolContinuation)
{
	const selection = turn.toolSelection;
	if (selection === null || value.bootstrapId !== turn.bootstrapId || value.runId !== turn.compile.runId || value.attempt !== turn.compile.attempt || value.compiledInputDigest !== turn.compile.digest
		|| value.proposalId !== selection.proposalId || value.declaration.payloadRef !== selection.payloadRef || value.declaration.ciphertextDigest !== selection.ciphertextDigest)
		throw new Error("Conversation model continuation crossed its original tool selection");
}
