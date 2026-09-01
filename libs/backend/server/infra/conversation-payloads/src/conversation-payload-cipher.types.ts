/**
 * Names the server-derived coordinates authenticated with a private ConversationComputer payload.
 *
 * The ciphertext is unusable when a copied row is presented for another silo, conversation, command,
 * or verified plaintext digest. Callers must derive these values from their admitted execution rather
 * than accept them from the Sandbox.
 */
export interface ConversationPayloadAssociatedData
{
	/** Fixes the stored payload format. */
	readonly formatVersion: "conversation-payload/v1";
	/** Binds the ciphertext to one silo. */
	readonly siloId: string;
	/** Binds the ciphertext to one conversation history stream. */
	readonly conversationId: string;
	/** Binds the ciphertext to one server-derived idempotency key. */
	readonly idempotencyKey: string;
	/** Binds the ciphertext to the digest the caller already verified. */
	readonly plaintextDigest: `sha256:${string}`;
}

/**
 * Carries the non-plaintext data required to decrypt a stored ConversationComputer payload.
 *
 * Storage keeps `keyId` with the AES-GCM output so a retained historic key can still read a payload
 * written before rotation. It must pass the same {@link ConversationPayloadAssociatedData} to open it.
 */
export interface SealedConversationPayload
{
	/** Identifies the retained key that encrypted these bytes. */
	readonly keyId: string;
	/** Holds only AES-GCM ciphertext. */
	readonly ciphertext: Uint8Array;
	/** Holds the random AES-GCM nonce. */
	readonly nonce: Uint8Array;
	/** Holds the AES-GCM authentication tag. */
	readonly authenticationTag: Uint8Array;
}

/**
 * Defines the server-side encryption boundary for private ConversationComputer payloads.
 *
 * Conversation authorities provide bytes and their server-derived coordinates, then persist the sealed
 * result outside conversation history. An authentication failure means the caller must reject the
 * stored value rather than treat it as another command's payload.
 */
export interface ConversationPayloadCipher
{
	/**
	 * Encrypts a payload and authenticates its server-derived coordinates with it.
	 *
	 * @param plaintext - The private bytes that the caller will not append to conversation history.
	 * @param associatedData - The coordinates the server derived for this payload.
	 * @returns The ciphertext and key metadata that storage may retain.
	 * @throws Error when the keyring or cryptographic operation cannot produce an authenticated payload.
	 */
	seal(plaintext: Uint8Array, associatedData: ConversationPayloadAssociatedData): Promise<SealedConversationPayload>;
	/**
	 * Decrypts ciphertext when it is presented with its original authenticated coordinates.
	 *
	 * @param sealed - The stored ciphertext and key metadata to verify and decrypt.
	 * @param associatedData - The server-derived coordinates expected for this payload.
	 * @returns The original private bytes after the authentication tag verifies.
	 * @throws Error when the key is unavailable or any ciphertext coordinate, nonce, or tag was altered.
	 */
	open(sealed: SealedConversationPayload, associatedData: ConversationPayloadAssociatedData): Promise<Uint8Array>;
}
