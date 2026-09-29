// Routine instruction context and ciphertext cross injected runtime boundaries, so these schemas must change with their scheduling models.
import { z } from "zod";

import type { RoutineInstructionContext, RoutineInstructionEnvelope } from "./routine-instruction.types";

/** Accepts an exact nonblank identifier without changing the supplied evidence. */
const _IdentifierSchema = z.string().refine(function _IsIdentifier(value): boolean { return value.length > 0 && value === value.trim(); });

/** Accepts the lowercase digest format stored with encrypted routine instructions. */
const _DigestSchema = z.custom<`sha256:${string}`>(function _IsDigest(value): value is `sha256:${string}`
{
	return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
});

/** Copies a byte view into an ArrayBuffer owned by the parsed routine envelope. */
const _OwnedBytesSchema = z.instanceof(Uint8Array).transform(function _OwnedBytes(value): Uint8Array<ArrayBuffer>
{
	return Uint8Array.from(value);
});

/** Validates every ownership coordinate and rejects fields outside the context model. */
export const _RoutineInstructionContextSchema: z.ZodType<RoutineInstructionContext> = z.object({
	siloId: _IdentifierSchema,
	destinationConversationId: _IdentifierSchema,
	requesterSubjectId: _IdentifierSchema,
	routineId: _IdentifierSchema,
	routineRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

/** Validates the complete cipher result, rejects unknown fields, and returns owned bytes. */
export const _RoutineInstructionEnvelopeSchema: z.ZodType<RoutineInstructionEnvelope> = z.object({
	keyId: _IdentifierSchema,
	nonce: _OwnedBytesSchema,
	authTag: _OwnedBytesSchema,
	ciphertext: _OwnedBytesSchema,
	ciphertextDigest: _DigestSchema,
}).strict();

/** Parses runtime context without including any supplied value in an error. */
export function _ParseRoutineInstructionContext(value: unknown): RoutineInstructionContext
{
	const parsed = _RoutineInstructionContextSchema.safeParse(value);
	if (!parsed.success)
	{
		throw new Error("Routine instruction cipher context is invalid");
	}
	return parsed.data;
}

/** Parses one cipher result without including plaintext or ciphertext in an error. */
export function _ParseRoutineInstructionEnvelope(value: unknown): RoutineInstructionEnvelope
{
	const parsed = _RoutineInstructionEnvelopeSchema.safeParse(value);
	if (!parsed.success)
	{
		throw new Error("Routine instruction cipher envelope is invalid");
	}
	return parsed.data;
}
