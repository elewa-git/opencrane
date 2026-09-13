/** Complete encrypted representation persisted outside immutable conversation history. */
export interface EncryptedConversationPrivatePayload
{
	/** AES-GCM authentication tag that protects the ciphertext and its bound coordinates. */
	readonly authTag: Uint8Array;
	/** Ciphertext bytes whose digest is recorded in the KurrentDB entry. */
	readonly ciphertext: Uint8Array;
	/** SHA-256 digest of the exact ciphertext bytes. */
	readonly ciphertextDigest: string;
	/** Identifies the mounted key required to decrypt this payload. */
	readonly keyId: string;
	/** Unique AES-GCM nonce generated for this payload. */
	readonly nonce: Uint8Array;
}

/** Mounted keyring document read once by the OpenCrane composition root. */
export interface ConversationPrivatePayloadKeyringDocument
{
	/** Selects the key used for new encrypted payloads. */
	readonly currentKeyId: string;
	/** Maps stable key identifiers to base64url-encoded 256-bit keys. */
	readonly keys: Readonly<Record<string, string>>;
}

/** Encrypts and decrypts conversation text without granting persistence or history authority. */
export interface ConversationPrivatePayloadCipher
{
	/** Decrypts one authenticated payload after participant authorization succeeds. */
	decrypt(payload: EncryptedConversationPrivatePayload, coordinates: ConversationPrivatePayloadCoordinates): string;
	/** Encrypts one plaintext value while binding it to its immutable payload coordinates. */
	encrypt(plaintext: string, coordinates: ConversationPrivatePayloadCoordinates): EncryptedConversationPrivatePayload;
}

/** Coordinates authenticated into AES-GCM so ciphertext cannot move across participants or conversations. */
export interface ConversationPrivatePayloadCoordinates
{
	/** Identifies the participant that submitted the private payload. */
	readonly authorSubject: string;
	/** Identifies the owning conversation. */
	readonly conversationId: string;
	/** Identifies the opaque payload reference carried by the KurrentDB entry. */
	readonly payloadRef: string;
	/** Identifies the owning silo. */
	readonly siloId: string;
}
