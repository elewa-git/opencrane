/**
 * Carries the text and ownership coordinates for one private-payload write.
 *
 * The composing authority must derive the coordinates after it has authorized the operation. The
 * store authenticates those coordinates with the ciphertext, so a copied row cannot serve another
 * conversation or idempotency key.
 * @see ConversationPayloadAssociatedData
 */
export interface ConversationPrivatePayloadStoreCommand
{
	/** Names the tenant that owns the payload and its encryption coordinates. */
	readonly siloId: string;
	/** Names the one conversation whose immutable history may later reference this payload. */
	readonly conversationId: string;
	/** Names the server-derived command or resolution key that owns the first stored body. */
	readonly idempotencyKey: string;
	/** Supplies one participant-visible text body that never enters immutable history plaintext. */
	readonly text: string;
}

/**
 * Returns the non-plaintext values that a ConversationComputer history entry may retain.
 *
 * A caller records these values instead of text. The digest lets a reader detect a substituted
 * ciphertext before it asks the payload cipher to decrypt it.
 */
export interface StoredConversationPrivatePayload
{
	/** Names the opaque payload reference; only the server may resolve it to stored ciphertext. */
	readonly payloadRef: `payload://${string}`;
	/** Binds the history reference to the stored ciphertext bytes. */
	readonly ciphertextDigest: `sha256:${string}`;
}

/**
 * Carries the server-derived coordinates required to redeem one runtime input body.
 *
 * The store checks the row identifier, owner key, and ciphertext digest before it decrypts. A
 * caller cannot use this command to swap in another conversation's body or a changed ciphertext.
 */
export interface ConversationPrivatePayloadReadCommand
{
	/** Names the tenant that owns the payload and its authenticated ciphertext coordinates. */
	readonly siloId: string;
	/** Names the one conversation whose command stream selected the payload. */
	readonly conversationId: string;
	/** Names the server-issued input command that owns the private-payload row. */
	readonly idempotencyKey: string;
	/** Names the opaque row reference retained in the durable command envelope. */
	readonly payloadRef: `payload://${string}`;
	/** Binds the durable command reference to the exact stored ciphertext. */
	readonly ciphertextDigest: `sha256:${string}`;
}

/**
 * Represents one encrypted private-payload row between the store and its persistence adapter.
 *
 * The store creates `id`, derives both digests, and obtains the encrypted fields from
 * {@link ConversationPayloadCipher}; callers cannot use this type to choose a different owner key.
 */
export interface ConversationPrivatePayloadRecord
{
	/** Identifies the server-generated payload record. */
	readonly id: string;
	/** Names the silo that owns this record. */
	readonly siloId: string;
	/** Names the one conversation that owns this record. */
	readonly conversationId: string;
	/** Names the idempotency key that owns the stored body. */
	readonly idempotencyKey: string;
	/** Holds the plaintext digest used only for exact retry comparison. */
	readonly plaintextDigest: `sha256:${string}`;
	/** Holds the ciphertext digest published in immutable history. */
	readonly ciphertextDigest: `sha256:${string}`;
	/** Names the retained encryption key needed for future protected reads. */
	readonly keyId: string;
	/** Holds AES-GCM ciphertext only. */
	readonly ciphertext: Uint8Array;
	/** Holds the random AES-GCM nonce. */
	readonly nonce: Uint8Array;
	/** Holds the AES-GCM authentication tag. */
	readonly authenticationTag: Uint8Array;
}

/**
 * Defines the persistence operations that preserve one body for each owner key.
 *
 * An implementation must return the stored row from `find` and leave that row unchanged when
 * `createIfAbsent` sees the same key. The store reads again after insertion to identify which row
 * the database retained during an insert race.
 */
export interface ConversationPrivatePayloadRepository
{
	/**
	 * Loads the row for one silo, conversation, and idempotency key.
	 *
	 * @returns The stored row, or `null` when no write owns the key yet.
	 */
	find(command: Pick<ConversationPrivatePayloadStoreCommand, "siloId" | "conversationId" | "idempotencyKey">): Promise<ConversationPrivatePayloadRecord | null>;
	/** Loads one payload row by its opaque server-generated identifier for the store's ownership check. */
	findById(id: string): Promise<ConversationPrivatePayloadRecord | null>;
	/**
	 * Attempts to store a candidate without replacing an existing row.
	 *
	 * @returns Nothing; callers must read the owner key again because a concurrent insert may have won.
	 */
	createIfAbsent(record: ConversationPrivatePayloadRecord): Promise<void>;
}

/**
 * Encrypts an authorized text body and returns the values a history entry can retain.
 *
 * A repeat with the same text returns the original payload reference and digest. A repeat with
 * changed text under the same idempotency key fails, so the caller cannot attach a new body to an
 * existing command.
 */
export interface ConversationPrivatePayloadStore
{
	/**
	 * Stores text for an owner key, or replays the first stored values for the same text.
	 *
	 * @returns Opaque history values for the stored row.
	 * @throws Error when the command is invalid, the existing row has different text, or storage loses the inserted row.
	 */
	storeText(command: ConversationPrivatePayloadStoreCommand): Promise<StoredConversationPrivatePayload>;
	/**
	 * Decrypts one exact server-selected payload after the runtime command authority admitted it.
	 *
	 * The store verifies the durable reference, owner key, digest, AES-GCM associated data, and
	 * plaintext digest before returning bounded UTF-8 text. Every mismatch rejects rather than
	 * making ciphertext from a different command readable.
	 */
	readText(command: ConversationPrivatePayloadReadCommand): Promise<string>;
}
