/** AES-GCM bytes stored for one routine revision; plaintext never crosses the persistence port. */
export interface RoutineInstructionEnvelope
{
	/** Names the mounted key version required to decrypt the instruction. */
	readonly keyId: string;
	/** Carries the independently generated AES-GCM nonce. */
	readonly nonce: Uint8Array<ArrayBuffer>;
	/** Carries the AES-GCM authentication tag. */
	readonly authTag: Uint8Array<ArrayBuffer>;
	/** Carries the encrypted instruction bytes. */
	readonly ciphertext: Uint8Array<ArrayBuffer>;
	/** Binds storage and history references to the exact ciphertext. */
	readonly ciphertextDigest: `sha256:${string}`;
}

/** Additional authenticated data that prevents ciphertext from moving between routine revisions. */
export interface RoutineInstructionContext
{
	/** Organisation that owns the routine. */
	readonly siloId: string;
	/** Stable conversation in which a human created the routine. */
	readonly destinationConversationId: string;
	/** Original authenticated subject retained as creation evidence. */
	readonly requesterSubjectId: string;
	/** Stable routine identifier. */
	readonly routineId: string;
	/** Positive immutable routine revision. */
	readonly routineRevision: number;
}

/** Mounted instruction encryption port supplied by server composition. */
export interface RoutineInstructionCipher
{
	/** Encrypts one validated instruction before a replayable database transaction starts. */
	encrypt(plaintext: string, context: RoutineInstructionContext): Promise<RoutineInstructionEnvelope>;
	/** Decrypts an authorized revision after its database read transaction commits. */
	decrypt(envelope: RoutineInstructionEnvelope, context: RoutineInstructionContext): Promise<string>;
}
