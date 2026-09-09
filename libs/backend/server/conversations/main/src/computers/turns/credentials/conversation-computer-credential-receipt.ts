import { createHash } from "node:crypto";

import type { ConversationComputerCredentialIssueCommand, ConversationComputerCredentialReceipt } from "../../../conversation-computer-turn.types";
import type { ConversationPrivatePayloadCipher, ConversationPrivatePayloadCoordinates } from "../../../conversation-private-payload.types";
import { ConversationComputerCredentialStates, type ConversationComputerCredentialCustody } from "../../../db/conversation-computer-credential-persistence.types";
import type { EncryptedConversationComputerCredentialCustody, IssuedConversationComputerCredential } from "./conversation-computer-credential.types";

/** Encrypts and checks the first provider key without deciding whether the caller may use it. */
export class ConversationComputerCredentialReceiptCodec
{
	/** Uses the conversation payload cipher to authenticate the key's stored coordinates. */
	public constructor(private readonly cipher: ConversationPrivatePayloadCipher) {}

	/** Builds custody after issuance; the caller must persist it before returning the key. */
	public seal(input: ConversationComputerCredentialIssueCommand, fence: string, minted: IssuedConversationComputerCredential): EncryptedConversationComputerCredentialCustody
	{
		const coordinates = _coordinates(input.computer.siloId, input.computer.conversationId, input.bootstrapId);
		const encrypted = this.cipher.encrypt(minted.key, coordinates);
		return {
			bootstrapId: input.bootstrapId, siloId: input.computer.siloId, conversationId: input.computer.conversationId,
			keyAlias: input.keyAlias, modelAlias: input.modelAlias, state: ConversationComputerCredentialStates.Custodied,
			claimFence: fence, claimExpiresAt: new Date(0), expiresAt: new Date(minted.expiresAt),
			...encrypted, credentialDigest: _digest(minted.key),
		};
	}

	/**
	 * Checks the original key and receipt binding. Expiry is deliberately left to the caller because
	 * provider cleanup must also decrypt expired keys. Corrupt or incomplete custody throws.
	 */
	public open(row: ConversationComputerCredentialCustody): ConversationComputerCredentialReceipt
	{
		if (!_HasEncryptedCredentialCustody(row))
			throw new Error("Conversation computer credential is not in durable custody");
		const coordinates = _coordinates(row.siloId, row.conversationId, row.bootstrapId);
		const key = this.cipher.decrypt({ keyId: row.keyId, nonce: row.nonce, authTag: row.authTag, ciphertext: row.ciphertext, ciphertextDigest: row.ciphertextDigest }, coordinates);
		if (_digest(key) !== row.credentialDigest)
			throw new Error("Conversation computer attempt credential digest does not match");
		return { key, credentialDigest: row.credentialDigest, expiresAt: row.expiresAt.toISOString() };
	}
}

/** Checks completeness before the cipher receives a persisted encrypted key. */
export function _HasEncryptedCredentialCustody(row: ConversationComputerCredentialCustody): row is EncryptedConversationComputerCredentialCustody
{
	return row.keyId !== null && row.nonce !== null && row.authTag !== null && row.ciphertext !== null && row.ciphertextDigest !== null && row.credentialDigest !== null;
}

/** Binds custody to the bootstrap attempt and its conversation without using a participant identity. */
function _coordinates(siloId: string, conversationId: string, bootstrapId: string): ConversationPrivatePayloadCoordinates
{
	return { siloId, conversationId, payloadRef: bootstrapId, authorSubject: "conversation-computer" };
}

/** Records the same key digest for persistence, reuse and decryption checks. */
function _digest(key: string): string
{
	return `sha256:${createHash("sha256").update(key).digest("hex")}`;
}
