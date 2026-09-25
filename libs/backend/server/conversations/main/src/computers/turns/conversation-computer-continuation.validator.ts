import { z } from "zod";
import { ___ConversationModelToolCallSchema } from "@opencrane/contracts";

import type { ConversationComputerToolDeclaration, ConversationComputerToolExchange } from "./conversation-computer-continuation.types";

/**
 * Decode private turn events and decrypted custody before they reach the conversation loop.
 * These schemas own field shapes; event readers and custody checks enforce the original coordinates.
 */
const _Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const _Fence = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
const _Count = z.number().int().positive().safe();
const _Reference = z.object({ payloadRef: _Fence, ciphertextDigest: _Digest }).strict();

/** Validates encrypted model-response custody before recovery can admit its tool. */
export const _ConversationToolDeclarationSchema: z.ZodType<ConversationComputerToolDeclaration> = z.object({ bootstrapId: _Fence, runId: z.string().min(1), attempt: _Count, compiledInputDigest: _Digest, ordinal: _Count, modelInvocationFence: _Fence, acceptedAtEpochMs: _Count, requestNotAfterEpochMs: _Count, credentialDigest: _Digest, credentialExpiresAt: z.string().datetime({ offset: true }), call: ___ConversationModelToolCallSchema }).strict();

/** Validates the saved exact assistant/tool pair; current authority remains a separate check. */
export const _ConversationToolExchangeSchema: z.ZodType<ConversationComputerToolExchange> = z.object({ bootstrapId: _Fence, runId: z.string().min(1), attempt: _Count, compiledInputDigest: _Digest, ordinal: _Count, modelInvocationFence: _Fence, declaration: _Reference, proposalId: _Fence, toolInvocationId: _Fence, resultDigest: _Digest, call: ___ConversationModelToolCallSchema, resultContent: z.string().min(1) }).strict();
