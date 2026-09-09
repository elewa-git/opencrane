import { z } from "zod";
import { ConversationModelToolModes, ___ConversationModelToolCallSchema } from "@opencrane/contracts";

import type { ConversationComputerModelReservation } from "./conversation-computer-model.types";
import type { ConversationComputerContinuationReservation, ConversationComputerToolContinuation, ConversationComputerToolDeclaration, ConversationComputerToolSelection } from "./conversation-computer-continuation.types";

/**
 * Decode private turn events and decrypted custody before they reach the conversation loop.
 * These schemas own field shapes; event readers and custody checks enforce the original coordinates.
 */
const _Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const _Fence = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
const _Count = z.number().int().positive().safe();
const _Reference = z.object({ payloadRef: _Fence, ciphertextDigest: _Digest }).strict();
const _Reservation = z.object({ invocationFence: _Fence, ordinal: z.literal(1), tools: z.nativeEnum(ConversationModelToolModes), compiledInputDigest: _Digest, requestDigest: _Digest, maxCompletionTokens: _Count, authorityExpiresAtEpochMs: _Count, dispatchDeadlineEpochMs: _Count }).strict();

/** Rejects missing, extra and malformed fields before the private event's domain checks. */
export const _ConversationModelReservationSchema: z.ZodType<ConversationComputerModelReservation> = _Reservation;

/** Limits the final request to text and binds its exact saved continuation and result. */
export const _ConversationContinuationReservationSchema: z.ZodType<ConversationComputerContinuationReservation> = _Reservation.extend({ ordinal: z.literal(2), tools: z.literal(ConversationModelToolModes.None), continuation: _Reference, proposalId: _Fence, resultDigest: _Digest }).strict();

/** Validates the private tool decision without carrying model arguments into history. */
export const _ConversationToolSelectionSchema: z.ZodType<ConversationComputerToolSelection> = _Reference.extend({ proposalId: _Fence, requestFingerprint: _Digest }).strict();

/** Validates encrypted model-response custody before recovery can admit its tool. */
export const _ConversationToolDeclarationSchema: z.ZodType<ConversationComputerToolDeclaration> = z.object({ bootstrapId: _Fence, runId: z.string().min(1), attempt: _Count, compiledInputDigest: _Digest, modelInvocationFence: _Fence, acceptedAtEpochMs: _Count, requestNotAfterEpochMs: _Count, credentialDigest: _Digest, credentialExpiresAt: z.string().datetime({ offset: true }), call: ___ConversationModelToolCallSchema }).strict();

/** Validates the saved exact assistant/tool pair; current authority remains a separate check. */
export const _ConversationToolContinuationSchema: z.ZodType<ConversationComputerToolContinuation> = z.object({ bootstrapId: _Fence, runId: z.string().min(1), attempt: _Count, compiledInputDigest: _Digest, declaration: _Reference, proposalId: _Fence, resultDigest: _Digest, call: ___ConversationModelToolCallSchema, resultContent: z.string().min(1) }).strict();
