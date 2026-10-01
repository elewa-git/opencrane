import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import type { ConversationPrivatePayloadCipher, ConversationPrivatePayloadCoordinates, ConversationPrivatePayloadKeyringDocument, EncryptedConversationPrivatePayload } from "./conversation-private-payload.types";

/** Fixed authenticated cipher used for private conversation payloads. */
const _ALGORITHM = "aes-256-gcm";

/** Encrypts private conversation payloads with a deployment-mounted rotating keyring. */
export class AesGcmConversationPrivatePayloadCipher implements ConversationPrivatePayloadCipher
{
	/** Decoded 256-bit keys indexed by their stable mounted identifiers. */
	private readonly keys: ReadonlyMap<string, Buffer>;

	/** Validates the complete mounted keyring before any request may use it. */
	public constructor(private readonly currentKeyId: string, keys: Readonly<Record<string, string>>)
	{
		const decoded = new Map<string, Buffer>();
		for (const [keyId, encoded] of Object.entries(keys))
		{
			const key = Buffer.from(encoded, "base64url");
			if (!_Identifier(keyId) || key.length !== 32)
				throw new Error("Conversation private payload keyring requires named 256-bit keys");
			decoded.set(keyId, key);
		}
		if (!_Identifier(currentKeyId) || !decoded.has(currentKeyId))
			throw new Error("Conversation private payload keyring requires its current key");
		this.keys = decoded;
	}

	/** Builds a validated cipher from one parsed Secret-mounted keyring document. */
	public static fromDocument(document: ConversationPrivatePayloadKeyringDocument): AesGcmConversationPrivatePayloadCipher
	{
		return new AesGcmConversationPrivatePayloadCipher(document.currentKeyId, document.keys);
	}

	/** Encrypts UTF-8 text, including an attachment-only message, and authenticates its ownership coordinates. */
	public encrypt(plaintext: string, coordinates: ConversationPrivatePayloadCoordinates): EncryptedConversationPrivatePayload
	{
		_ValidateCoordinates(coordinates);
		if (Buffer.byteLength(plaintext, "utf8") > 65_536)
			throw new Error("Conversation private payload text must contain at most 65536 UTF-8 bytes");
		const nonce = randomBytes(12);
		const cipher = createCipheriv(_ALGORITHM, this.keys.get(this.currentKeyId)!, nonce);
		cipher.setAAD(_AdditionalData(coordinates));
		const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
		return { authTag: cipher.getAuthTag(), ciphertext, ciphertextDigest: `sha256:${createHash("sha256").update(ciphertext).digest("hex")}`, keyId: this.currentKeyId, nonce };
	}

	/** Decrypts only after AES-GCM verifies the payload bytes and their immutable coordinates. */
	public decrypt(payload: EncryptedConversationPrivatePayload, coordinates: ConversationPrivatePayloadCoordinates): string
	{
		_ValidateCoordinates(coordinates);
		const key = this.keys.get(payload.keyId);
		if (key === undefined)
			throw new Error("Conversation private payload references an unavailable key");
		const digest = `sha256:${createHash("sha256").update(payload.ciphertext).digest("hex")}`;
		if (digest !== payload.ciphertextDigest)
			throw new Error("Conversation private payload ciphertext digest does not match");
		const decipher = createDecipheriv(_ALGORITHM, key, payload.nonce);
		decipher.setAAD(_AdditionalData(coordinates));
		decipher.setAuthTag(Buffer.from(payload.authTag));
		return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]).toString("utf8");
	}
}

/** Serializes ownership coordinates into unambiguous authenticated additional data. */
function _AdditionalData(coordinates: ConversationPrivatePayloadCoordinates): Buffer
{
	return Buffer.from(JSON.stringify([coordinates.siloId, coordinates.conversationId, coordinates.payloadRef, coordinates.authorSubject]), "utf8");
}

/** Checks one exact identifier without accepting whitespace normalization. */
function _Identifier(value: string): boolean
{
	return value.trim().length > 0 && value === value.trim();
}

/** Rejects malformed ownership coordinates before encryption or decryption. */
function _ValidateCoordinates(coordinates: ConversationPrivatePayloadCoordinates): void
{
	if (![_Identifier(coordinates.siloId), _Identifier(coordinates.conversationId), _Identifier(coordinates.payloadRef), _Identifier(coordinates.authorSubject)].every(Boolean))
		throw new Error("Conversation private payload requires exact ownership coordinates");
}
