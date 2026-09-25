import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { ___CanonicalizeJson, ___ParseAndValidateJson, type JsonValue } from "@opencrane/util";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import type { ConversationComputerModelCustody, ConversationComputerToolDeclaration, ConversationComputerToolExchange } from "../conversation-computer-continuation.types";
import { _ConversationToolDeclarationSchema, _ConversationToolExchangeSchema } from "../conversation-computer-continuation.validator";
import type { ConversationComputerPrivateModelReference } from "../conversation-computer-turn-protocol.types";
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
		return this._Store(turn, "declaration", declaration.ordinal, declaration.modelInvocationFence, ___CanonicalizeJson(declaration as unknown as JsonValue));
	}

	/** Recover committed custody after a lost selection append; current tool authority is checked by the caller. */
	public async loadDeclaration(turn: FrozenConversationComputerTurn, ordinal?: number)
	{
		const steps = ordinal === undefined ? turn.protocol.steps.slice(-1) : turn.protocol.steps.filter(step => step.reservation.ordinal === ordinal);
		for (const step of steps)
		{
			const saved = await this._Read(turn, "declaration", step.reservation.ordinal, step.reservation.invocationFence);
			if (saved === null)
				continue;
			const declaration = ___ParseAndValidateJson(saved.text, "Conversation model declaration", value => _ConversationToolDeclarationSchema.parse(value));
			_AssertDeclaration(turn, declaration);
			return { declaration, reference: saved.reference };
		}
		return null;
	}

	/** Commit the exact assistant/tool pair before the next model request consumes the delivery. */
	public async storeExchange(turn: FrozenConversationComputerTurn, exchange: ConversationComputerToolExchange)
	{
		_AssertExchange(turn, _ConversationToolExchangeSchema.parse(exchange));
		const declaration = await this._Read(turn, "declaration", exchange.ordinal, exchange.modelInvocationFence);
		if (declaration === null)
			throw new Error("Conversation model exchange requires its saved declaration");
		const savedDeclaration = ___ParseAndValidateJson(declaration.text, "Conversation model declaration", value => _ConversationToolDeclarationSchema.parse(value));
		if (___CanonicalizeJson(savedDeclaration.call as unknown as JsonValue) !== ___CanonicalizeJson(exchange.call as unknown as JsonValue))
			throw new Error("Conversation model exchange differs from its saved declaration");
		return this._Store(turn, "exchange", exchange.ordinal, exchange.modelInvocationFence, ___CanonicalizeJson(exchange as unknown as JsonValue));
	}

	/** Read only the exact ciphertext named by the saved ordered result. */
	public async loadExchange(turn: FrozenConversationComputerTurn, reference: ConversationComputerPrivateModelReference)
	{
		const step = turn.protocol.steps.find(candidate => candidate.result?.exchange.payloadRef === reference.payloadRef && candidate.result.exchange.ciphertextDigest === reference.ciphertextDigest);
		if (step === undefined)
			throw new Error("Conversation model exchange custody differs from its saved reference");
		const saved = await this._Read(turn, "exchange", step.reservation.ordinal, step.reservation.invocationFence);
		if (saved === null || saved.reference.payloadRef !== reference.payloadRef || saved.reference.ciphertextDigest !== reference.ciphertextDigest)
			throw new Error("Conversation model exchange custody differs from its saved reference");
		const exchange = ___ParseAndValidateJson(saved.text, "Conversation model exchange", value => _ConversationToolExchangeSchema.parse(value));
		_AssertExchange(turn, exchange);
		const declaration = await this._Read(turn, "declaration", step.reservation.ordinal, step.reservation.invocationFence);
		if (declaration === null)
			throw new Error("Conversation model exchange requires its saved declaration");
		const savedDeclaration = ___ParseAndValidateJson(declaration.text, "Conversation model declaration", value => _ConversationToolDeclarationSchema.parse(value));
		if (___CanonicalizeJson(savedDeclaration.call as unknown as JsonValue) !== ___CanonicalizeJson(exchange.call as unknown as JsonValue))
			throw new Error("Conversation model exchange differs from its saved declaration");
		return exchange;
	}

	private async _Store(turn: FrozenConversationComputerTurn, domain: "declaration" | "exchange", ordinal: number, fence: string, text: string)
	{
		const existing = await this._Read(turn, domain, ordinal, fence);
		if (existing !== null)
		{
			if (existing.text !== text)
				throw new Error("Conversation model custody cannot replace saved content");
			return existing.reference;
		}
		const coordinates = _Coordinates(turn, domain, ordinal, fence);
		const encrypted = this.cipher.encrypt(text, coordinates);
		await this.transaction.conversationPrivatePayload.create({ data: { id: coordinates.payloadRef, siloId: coordinates.siloId, conversationId: coordinates.conversationId, authorSubject: coordinates.authorSubject, idempotencyKey: coordinates.payloadRef, keyId: encrypted.keyId, nonce: Buffer.from(encrypted.nonce), authTag: Buffer.from(encrypted.authTag), ciphertext: Buffer.from(encrypted.ciphertext), ciphertextDigest: encrypted.ciphertextDigest } });
		return { payloadRef: coordinates.payloadRef, ciphertextDigest: encrypted.ciphertextDigest };
	}

	private async _Read(turn: FrozenConversationComputerTurn, domain: "declaration" | "exchange", ordinal: number, fence: string)
	{
		const coordinates = _Coordinates(turn, domain, ordinal, fence);
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
	public loadDeclaration(turn: FrozenConversationComputerTurn, ordinal?: number)
	{
		return this._Run(repository => repository.loadDeclaration(turn, ordinal));
	}
	public storeExchange(turn: FrozenConversationComputerTurn, exchange: ConversationComputerToolExchange)
	{
		return this._Run(repository => repository.storeExchange(turn, exchange));
	}
	public loadExchange(turn: FrozenConversationComputerTurn, reference: ConversationComputerPrivateModelReference)
	{
		return this._Run(repository => repository.loadExchange(turn, reference));
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
function _Coordinates(turn: FrozenConversationComputerTurn, domain: "declaration" | "exchange", ordinal: number, fence: string)
{
	const hex = createHash("sha256").update(JSON.stringify(["conversation-model-custody", domain, turn.bootstrapId, ordinal, fence])).digest("hex");
	const payloadRef = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
	return { siloId: turn.siloId, conversationId: turn.binding.conversationId, payloadRef, authorSubject: turn.binding.agentIdentityId };
}

/** A saved acceptance time may precede recovery, but cannot exceed the original dispatch/key window. */
function _AssertDeclaration(turn: FrozenConversationComputerTurn, value: ConversationComputerToolDeclaration)
{
	const step = turn.protocol.steps.find(candidate => candidate.reservation.ordinal === value.ordinal);
	if (step === undefined || value.bootstrapId !== turn.bootstrapId || value.runId !== turn.compile.runId || value.attempt !== turn.compile.attempt || value.compiledInputDigest !== turn.compile.digest || value.modelInvocationFence !== step.reservation.invocationFence
		|| value.acceptedAtEpochMs > Date.now() || value.acceptedAtEpochMs >= value.requestNotAfterEpochMs || value.requestNotAfterEpochMs > step.reservation.dispatchDeadlineEpochMs || value.requestNotAfterEpochMs > Date.parse(value.credentialExpiresAt))
		throw new Error("Conversation model declaration crossed its original accepted response");
}

/** The pair keeps the original input anchor and selected encrypted declaration unchanged. */
function _AssertExchange(turn: FrozenConversationComputerTurn, value: ConversationComputerToolExchange)
{
	const step = turn.protocol.steps.find(candidate => candidate.reservation.ordinal === value.ordinal);
	const selection = step?.selection;
	if (step === undefined || selection === null || selection === undefined || value.bootstrapId !== turn.bootstrapId || value.runId !== turn.compile.runId || value.attempt !== turn.compile.attempt || value.compiledInputDigest !== turn.compile.digest
		|| value.modelInvocationFence !== step.reservation.invocationFence || value.proposalId !== selection.proposalId || value.toolInvocationId !== selection.toolInvocationId || step.result !== null && value.resultDigest !== step.result.resultDigest || value.declaration.payloadRef !== selection.declaration.payloadRef || value.declaration.ciphertextDigest !== selection.declaration.ciphertextDigest)
		throw new Error("Conversation model exchange crossed its original tool selection");
}
