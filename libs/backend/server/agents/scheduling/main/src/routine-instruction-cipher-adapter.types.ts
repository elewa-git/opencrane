import type { RoutineInstructionEnvelope } from "./routine-instruction.types";

/** Coordinates understood by the injected payload cipher without importing its owning package. */
export interface RoutineInstructionPayloadCoordinates
{
	/** Identifies the subject whose approved routine instruction is encrypted. */
	readonly authorSubject: string;
	/** Identifies the conversation from which the routine was created. */
	readonly conversationId: string;
	/** Identifies the purpose and immutable routine revision bound into authenticated data. */
	readonly payloadRef: string;
	/** Identifies the organisation that owns the routine. */
	readonly siloId: string;
}

/** Payload shape returned by the shared cipher before scheduling narrows owned bytes and the digest. */
export type RoutineInstructionPayloadCiphertext = Omit<RoutineInstructionEnvelope, "authTag" | "ciphertext" | "ciphertextDigest" | "nonce"> & {
	/** Authentication tag owned by the shared cipher implementation. */
	readonly authTag: Uint8Array;
	/** Ciphertext bytes owned by the shared cipher implementation. */
	readonly ciphertext: Uint8Array;
	/** Digest returned by the shared cipher and validated before persistence. */
	readonly ciphertextDigest: string;
	/** Nonce owned by the shared cipher implementation. */
	readonly nonce: Uint8Array;
};

/** Small structural port implemented by the server's mounted rotating payload cipher. */
export interface RoutineInstructionPayloadCipher
{
	/** Decrypts after the shared cipher verifies its algorithm, key, digest, tag, and coordinates. */
	decrypt(payload: RoutineInstructionPayloadCiphertext, coordinates: RoutineInstructionPayloadCoordinates): string;
	/** Encrypts while the shared cipher owns its algorithm, nonce generation, key rotation, and size limit. */
	encrypt(plaintext: string, coordinates: RoutineInstructionPayloadCoordinates): RoutineInstructionPayloadCiphertext;
}
