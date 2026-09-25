import { z } from "zod";
import { ___ConversationModelPreForwardReceiptSchema } from "@opencrane/contracts";

import type { ConversationComputerModelRejection, ConversationComputerModelRetryClaim } from "./conversation-computer-model-retry.types";

const _EpochMs = z.number().int().positive().safe();

/** Rejects malformed or extended evidence; parsing does not authenticate a proxy receipt. */
export const _ConversationComputerModelRejectionSchema: z.ZodType<ConversationComputerModelRejection> = z.object({
	receipt: ___ConversationModelPreForwardReceiptSchema,
	credentialDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
	credentialExpiresAt: z.string().datetime({ offset: true }),
	receivedAtEpochMs: _EpochMs,
}).strict();

/** Validates claim fields before the protocol checks their current reservation and predecessor. */
export const _ConversationComputerModelRetryClaimSchema: z.ZodType<ConversationComputerModelRetryClaim> = z.object({
	ordinal: z.number().int().positive().safe(),
	modelInvocationFence: z.string().uuid(),
	retryOrdinal: z.number().int().positive().safe(),
	physicalNonce: z.string().regex(/^[0-9a-f]{64}$/u),
	claimedAtEpochMs: _EpochMs,
}).strict();
