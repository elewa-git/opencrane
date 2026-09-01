import { createHash, randomUUID } from "node:crypto";

import type { ConversationPayloadCipher } from "@opencrane/backend/server/infra/conversation-payloads";

import type { ConversationPrivatePayloadReadCommand, ConversationPrivatePayloadRecord, ConversationPrivatePayloadRepository, ConversationPrivatePayloadStore as ConversationPrivatePayloadStorePort, ConversationPrivatePayloadStoreCommand, StoredConversationPrivatePayload } from "./conversation-private-payload-store.types";

/** Limits a body before the store allocates ciphertext for it. */
const _MaximumTextBytes = 64 * 1024;
/** Recognizes the complete digest form that immutable command envelopes retain. */
const _DigestPattern = /^sha256:[0-9a-f]{64}$/iu;

/**
 * Stores ConversationComputer text under one authorization-owned idempotency key.
 *
 * A composing authority supplies coordinates it derived after authorization. This class authenticates
 * them with the ciphertext and returns no plaintext, leaving the caller to append the resulting
 * reference to history in its own transaction.
 * @implements ConversationPrivatePayloadStorePort
 */
export class ConversationPrivatePayloadStore implements ConversationPrivatePayloadStorePort
{
	/** Reads and creates rows keyed by silo, conversation, and idempotency key. */
	private readonly repository: ConversationPrivatePayloadRepository;
	/** Encrypts text and authenticates its ownership coordinates. */
	private readonly cipher: ConversationPayloadCipher;

	/**
	 * Creates a private-payload store from a persistence adapter and cipher.
	 *
	 * @param repository - The adapter that retains the first row for each owner key.
	 * @param cipher - The cipher that binds the row to its supplied ownership coordinates.
	 */
	constructor(repository: ConversationPrivatePayloadRepository, cipher: ConversationPayloadCipher)
	{
		this.repository = repository;
		this.cipher = cipher;
	}

	/**
	 * Stores a text body or returns the first row written for the same idempotency key.
	 *
	 * The initial lookup avoids encrypting a response-lost retry again. The second lookup makes the
	 * database's unique row authoritative when two processes tried to write the same key. This method
	 * does not authenticate callers or append history.
	 *
	 * @param command - The authorized text and its server-derived ownership coordinates.
	 * @returns Opaque reference and digest for the first row that owns the key.
	 * @throws Error when the command is malformed, the key already owns changed text, or the inserted row is absent.
	 */
	async storeText(command: ConversationPrivatePayloadStoreCommand): Promise<StoredConversationPrivatePayload>
	{
		_Validate(command);
		const plaintext = Buffer.from(command.text, "utf8");
		const plaintextDigest = _Digest(plaintext);

		// 1. Read first so a response-lost retry returns its original row without encrypting again.
		const existing = await this.repository.find(command);
		if (existing !== null)
			return _Stored(existing, plaintextDigest);

		// 2. Encrypt validated text with the coordinates that a later history entry will retain.
		const sealed = await this.cipher.seal(plaintext, {
			formatVersion: "conversation-payload/v1",
			siloId: command.siloId,
			conversationId: command.conversationId,
			idempotencyKey: command.idempotencyKey,
			plaintextDigest,
		});
		const candidate: ConversationPrivatePayloadRecord = {
			id: randomUUID(),
			siloId: command.siloId,
			conversationId: command.conversationId,
			idempotencyKey: command.idempotencyKey,
			plaintextDigest,
			ciphertextDigest: _Digest(sealed.ciphertext),
			keyId: sealed.keyId,
			ciphertext: sealed.ciphertext,
			nonce: sealed.nonce,
			authenticationTag: sealed.authenticationTag,
		};
		await this.repository.createIfAbsent(candidate);

		// 3. Read again because another process may have inserted the row while this process encrypted.
		const stored = await this.repository.find(command);
		if (stored === null)
			throw new Error("Conversation private payload store lost its inserted record");
		return _Stored(stored, plaintextDigest);
	}

	/** Redeems one authenticated stored body for an already-admitted runtime command. */
	async readText(command: ConversationPrivatePayloadReadCommand): Promise<string>
	{
		_ValidateRead(command);
		const payloadId = _PayloadId(command.payloadRef);
		const stored = await this.repository.findById(payloadId);
		if (stored === null)
			throw new Error("Conversation private payload is unavailable");
		if (stored.siloId !== command.siloId || stored.conversationId !== command.conversationId || stored.idempotencyKey !== command.idempotencyKey || stored.ciphertextDigest !== command.ciphertextDigest)
			throw new Error("Conversation private payload does not match its command");
		const plaintext = await this.cipher.open({ keyId: stored.keyId, ciphertext: stored.ciphertext, nonce: stored.nonce, authenticationTag: stored.authenticationTag }, {
			formatVersion: "conversation-payload/v1",
			siloId: command.siloId,
			conversationId: command.conversationId,
			idempotencyKey: command.idempotencyKey,
			plaintextDigest: stored.plaintextDigest,
		});
		if (_Digest(plaintext) !== stored.plaintextDigest)
			throw new Error("Conversation private payload plaintext digest is invalid");
		const text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
		_Validate({ siloId: command.siloId, conversationId: command.conversationId, idempotencyKey: command.idempotencyKey, text });
		return text;
	}
}

/** Creates the `sha256:` value stored as a plaintext or ciphertext digest. */
function _Digest(value: Uint8Array): `sha256:${string}`
{
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/** Rejects blank ownership coordinates and text that exceeds this store's body limit. */
function _Validate(command: ConversationPrivatePayloadStoreCommand): void
{
	if (!_Identifier(command.siloId) || !_Identifier(command.conversationId) || !_Identifier(command.idempotencyKey))
		throw new Error("Conversation private payload store requires non-blank ownership coordinates");
	if (command.text.trim().length === 0 || Buffer.byteLength(command.text, "utf8") > _MaximumTextBytes)
		throw new Error("Conversation private payload store requires bounded non-blank text");
}

/** Rejects a malformed durable reference before it can select a private-payload row. */
function _ValidateRead(command: ConversationPrivatePayloadReadCommand): void
{
	if (!_Identifier(command.siloId) || !_Identifier(command.conversationId) || !_Identifier(command.idempotencyKey) || !_DigestPattern.test(command.ciphertextDigest))
		throw new Error("Conversation private payload read requires valid ownership coordinates");
	_PayloadId(command.payloadRef);
}

/** Parses only the opaque UUID reference generated when the payload row was first stored. */
function _PayloadId(payloadRef: string): string
{
	const match = /^payload:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu.exec(payloadRef);
	if (match === null)
		throw new Error("Conversation private payload reference is invalid");
	return match[1];
}

/** Allows any non-blank identifier within the database guard's maximum length. */
function _Identifier(value: string): boolean
{
	return value.trim().length > 0 && value.length <= 256;
}

/** Returns history values after confirming that the retained row has the requested plaintext digest. */
function _Stored(record: ConversationPrivatePayloadRecord, plaintextDigest: `sha256:${string}`): StoredConversationPrivatePayload
{
	if (record.plaintextDigest !== plaintextDigest)
		throw new Error("Conversation private payload idempotency key already owns different text");
	return { payloadRef: `payload://${record.id}`, ciphertextDigest: record.ciphertextDigest };
}
