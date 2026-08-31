/** Plain associated-data coordinates authenticated with every continuation ciphertext. */
export interface RuntimeContinuationAssociatedData
{
	/** Continuation document version. */
	readonly formatVersion: string;
	/** Logical run that owns the ciphertext. */
	readonly runId: string;
	/** Attempt that owns the ciphertext. */
	readonly attempt: number;
	/** Input generation that owns the ciphertext. */
	readonly inputGeneration: number;
	/** Monotonic checkpoint revision authenticated with the ciphertext. */
	readonly revision: number;
}

/** Carries encrypted continuation bytes and the key metadata needed to open them after rotation. */
export interface SealedRuntimeContinuation
{
	/** Keyring identifier required to decrypt this row after rotation. */
	readonly keyId: string;
	/** AES-GCM ciphertext with no plaintext continuation content. */
	readonly ciphertext: Uint8Array;
	/** Random 96-bit AES-GCM nonce. */
	readonly nonce: Uint8Array;
	/** Authentication tag that rejects changed ciphertext or associated data. */
	readonly authenticationTag: Uint8Array;
}

/**
 * Encrypts continuation documents before the protocol adapter writes them to the database.
 *
 * Implementations must authenticate the supplied coordinates as associated data and must support
 * opening rows written by keys that remain in the mounted keyring. The adapter treats any open
 * failure as unusable state rather than attempting an unverified resume.
 *
 * Called by: `PrismaRuntimeContinuationAuthorityUnitOfWork`.
 */
export interface RuntimeContinuationCipher
{
	/** Encrypts a size-checked UTF-8 document and authenticates its database coordinates. */
	seal(plaintext: Uint8Array, associatedData: RuntimeContinuationAssociatedData): Promise<SealedRuntimeContinuation>;
	/** Decrypts a saved document only when its retained key and database coordinates authenticate. */
	open(sealed: SealedRuntimeContinuation, associatedData: RuntimeContinuationAssociatedData): Promise<Uint8Array>;
}
