import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { ConversationPayloadAssociatedData, ConversationPayloadCipher, SealedConversationPayload } from "./conversation-payload-cipher.types";

/** Represents the validated rotating keyring read from the server-only Secret mount. */
interface ConversationPayloadKeyring
{
	/** Selects the key used for new ciphertext. */
	readonly activeKeyId: string;
	/** Retains each base64-encoded AES-256 key needed to read stored payloads. */
	readonly keys: Readonly<Record<string, string>>;
}

/** Converts one immutable payload identity into stable AES-GCM associated data. */
function _AssociatedData(value: ConversationPayloadAssociatedData): Buffer
{
	return Buffer.from(JSON.stringify([value.formatVersion, value.siloId, value.conversationId, value.idempotencyKey, value.plaintextDigest]), "utf8");
}

/** Decodes only the canonical base64 form of one 256-bit AES key. */
function _DecodeKey(encoded: string): Buffer
{
	const key = Buffer.from(encoded, "base64");
	if (key.length !== 32 || key.toString("base64") !== encoded)
		throw new Error("conversation payload key must be canonical 256-bit base64");
	return key;
}

/** Parses the mounted keyring without retaining key bytes on this adapter. */
function _ParseKeyring(value: string): ConversationPayloadKeyring
{
	const parsed = JSON.parse(value) as Partial<ConversationPayloadKeyring>;
	if (typeof parsed.activeKeyId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(parsed.activeKeyId) || parsed.keys === undefined || typeof parsed.keys !== "object")
		throw new Error("conversation payload keyring is malformed");
	const keys = parsed.keys as Record<string, unknown>;
	const encoded = keys[parsed.activeKeyId];
	if (typeof encoded !== "string")
		throw new Error("conversation payload active key is missing");
	_DecodeKey(encoded).fill(0);
	for (const retainedKey of Object.values(keys))
	{
		if (typeof retainedKey !== "string")
			throw new Error("conversation payload keyring contains a non-string retained key");
		_DecodeKey(retainedKey).fill(0);
	}
	return { activeKeyId: parsed.activeKeyId, keys: keys as Readonly<Record<string, string>> };
}

/** Reads one short-lived key from the current mounted payload keyring. */
async function _ReadKey(path: string, keyId: string | null): Promise<{ readonly keyId: string; readonly key: Buffer }>
{
	const keyring = _ParseKeyring(await readFile(path, "utf8"));
	const resolvedKeyId = keyId ?? keyring.activeKeyId;
	const encoded = keyring.keys[resolvedKeyId];
	if (typeof encoded !== "string")
		throw new Error("conversation payload key is unavailable");
	const key = _DecodeKey(encoded);
	return { keyId: resolvedKeyId, key };
}

/**
 * Encrypts ConversationComputer payloads with a dedicated Secret-mounted rotating AES-256-GCM keyring.
 *
 * The associated data binds ciphertext to the server-derived silo, conversation, command key, and
 * plaintext digest. A changed coordinate makes AES-GCM reject decryption, preventing one stored
 * payload from being reused for another ConversationComputer command.
 */
export class MountedConversationPayloadCipher implements ConversationPayloadCipher
{
	/** Points to the one read-only Secret projection that supplies conversation payload keys. */
	private readonly keyringPath: string;

	/**
	 * Creates an adapter that reads a Secret-mounted keyring at the supplied absolute path.
	 *
	 * @param keyringPath - The absolute read-only path provided by server deployment configuration.
	 * @throws Error when a relative path could resolve outside the intended mounted Secret.
	 */
	constructor(keyringPath: string)
	{
		if (!keyringPath.startsWith("/"))
			throw new Error("conversation payload keyring path must be absolute");
		this.keyringPath = keyringPath;
	}

	/**
	 * Encrypts a private payload with the current key and a fresh nonce.
	 *
	 * @param plaintext - The server-validated bytes to protect before storage.
	 * @param associatedData - The server-derived coordinates authenticated with the ciphertext.
	 * @returns Ciphertext with the key identifier and nonce needed for a later read.
	 * @throws Error when the mounted keyring cannot provide a valid active key.
	 */
	async seal(plaintext: Uint8Array, associatedData: ConversationPayloadAssociatedData): Promise<SealedConversationPayload>
	{
		const loaded = await _ReadKey(this.keyringPath, null);
		try
		{
			const nonce = randomBytes(12);
			const cipher = createCipheriv("aes-256-gcm", loaded.key, nonce);
			cipher.setAAD(_AssociatedData(associatedData));
			const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
			return { keyId: loaded.keyId, ciphertext, nonce, authenticationTag: cipher.getAuthTag() };
		}
		finally
		{
			loaded.key.fill(0);
		}
	}

	/**
	 * Decrypts ciphertext when its authenticated coordinates still match the server-derived payload identity.
	 *
	 * @param sealed - The stored ciphertext, nonce, tag, and key identifier to verify.
	 * @param associatedData - The server-derived coordinates expected for this payload.
	 * @returns The original bytes after AES-GCM verifies the ciphertext and its coordinates.
	 * @throws Error when the historic key is unavailable or AES-GCM rejects the stored value.
	 */
	async open(sealed: SealedConversationPayload, associatedData: ConversationPayloadAssociatedData): Promise<Uint8Array>
	{
		const loaded = await _ReadKey(this.keyringPath, sealed.keyId);
		try
		{
			const decipher = createDecipheriv("aes-256-gcm", loaded.key, sealed.nonce);
			decipher.setAAD(_AssociatedData(associatedData));
			decipher.setAuthTag(sealed.authenticationTag);
			return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]);
		}
		finally
		{
			loaded.key.fill(0);
		}
	}
}
