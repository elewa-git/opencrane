import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { RuntimeContinuationAssociatedData, RuntimeContinuationCipher, SealedRuntimeContinuation } from "./runtime-continuation-cipher.types";

/** Shape of the Secret-mounted keyring document re-read for every operation. */
interface RuntimeContinuationKeyring
{
	/** Identifier used for new ciphertext. */
	readonly activeKeyId: string;
	/** Base64-encoded 256-bit AES keys retained until every referenced row is gone. */
	readonly keys: Readonly<Record<string, string>>;
}

/** Convert associated-data fields into one stable authenticated byte sequence. */
function _AssociatedData(value: RuntimeContinuationAssociatedData): Buffer
{
	return Buffer.from(JSON.stringify([value.formatVersion, value.runId, value.attempt, value.inputGeneration, value.revision]), "utf8");
}

/** Parse and validate the Secret-mounted JSON keyring without retaining key bytes. */
function _ParseKeyring(value: string): RuntimeContinuationKeyring
{
	const parsed = JSON.parse(value) as Partial<RuntimeContinuationKeyring>;
	if (typeof parsed.activeKeyId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(parsed.activeKeyId) || !parsed.keys || typeof parsed.keys !== "object")
		throw new Error("runtime continuation keyring is malformed");
	const encoded = parsed.keys[parsed.activeKeyId];
	if (typeof encoded !== "string" || Buffer.from(encoded, "base64").length !== 32)
		throw new Error("runtime continuation active key must be 256 bits");
	return { activeKeyId: parsed.activeKeyId, keys: parsed.keys };
}

/** Read one key from the current mounted keyring and return a short-lived copy. */
async function _ReadKey(path: string, keyId: string | null): Promise<{ readonly keyId: string; readonly key: Buffer }>
{
	const keyring = _ParseKeyring(await readFile(path, "utf8"));
	const resolvedKeyId = keyId ?? keyring.activeKeyId;
	const encoded = keyring.keys[resolvedKeyId];
	if (typeof encoded !== "string")
		throw new Error("runtime continuation key is unavailable");
	const key = Buffer.from(encoded, "base64");
	if (key.length !== 32)
		throw new Error("runtime continuation key must be 256 bits");
	return { keyId: resolvedKeyId, key };
}

/**
 * Encrypts runtime continuations with a Secret-mounted rotating AES-256-GCM keyring.
 *
 * The file is read on every operation, so a Kubernetes Secret projection can rotate the active
 * key without restarting the server. Old keys remain addressable by identifier until no saved row
 * references them. Key material and plaintext are never retained on the class or logged.
 *
 * Called by: `PrismaRuntimeContinuationAuthorityUnitOfWork`, wired in
 * `apps/opencrane/src/app/runtime-composition.ts`.
 */
export class MountedRuntimeContinuationCipher implements RuntimeContinuationCipher
{
	/** Absolute path of the Secret-mounted keyring JSON document. */
	private readonly keyringPath: string;

	/** Create an adapter that reads only this absolute Secret path. */
	constructor(keyringPath: string)
	{
		if (!keyringPath.startsWith("/"))
			throw new Error("runtime continuation keyring path must be absolute");
		this.keyringPath = keyringPath;
	}

	/** Encrypt one document with a fresh nonce and the current active key. */
	async seal(plaintext: Uint8Array, associatedData: RuntimeContinuationAssociatedData): Promise<SealedRuntimeContinuation>
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

	/** Decrypt only when the named key, tag, and exact associated data authenticate. */
	async open(sealed: SealedRuntimeContinuation, associatedData: RuntimeContinuationAssociatedData): Promise<Uint8Array>
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
