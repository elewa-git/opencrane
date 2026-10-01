import { z } from "zod";

import { ConversationModelPreForwardContracts, ConversationModelPreForwardReasons, type ConversationModelDelivery, type ConversationModelPreForwardEnvelope, type ConversationModelPreForwardReceipt } from "./conversation-model-retry.types";

/**
 * Validates proxy receipt shapes and saved dispatch coordinates beside their shared models.
 * Extra fields are rejected. Cryptographic authentication and current authority remain with the
 * transport and workflow; successfully parsing a receipt does not authorize a retry.
 */

/** Requires the lowercase encoding used for nonces, fences and SHA-256 digests. */
const _hex = z.string().regex(/^[0-9a-f]{64}$/u);

/** Keeps times within the integer representation shared by the proxy and server. */
const _epochMs = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/** Rejects changed fields and reset times that cannot fit the request's original deadline. */
export const ___ConversationModelPreForwardReceiptSchema: z.ZodType<ConversationModelPreForwardReceipt> = z.object({
	version: z.literal(ConversationModelPreForwardContracts.V1),
	physicalNonce: _hex,
	logicalFence: _hex,
	requestBodySha256: _hex,
	deadlineEpochMs: _epochMs,
	retryAtEpochMs: _epochMs,
	reason: z.literal(ConversationModelPreForwardReasons.LocalRateLimit),
}).strict().refine(receipt => receipt.retryAtEpochMs < receipt.deadlineEpochMs);

/** Rejects provider envelopes, ambiguous extensions and a missing receipt. */
export const ___ConversationModelPreForwardEnvelopeSchema: z.ZodType<ConversationModelPreForwardEnvelope> = z.object({
	receipt: ___ConversationModelPreForwardReceiptSchema,
}).strict();

/** Validates the coordinates the durable model-dispatch owner gives to the transport. */
export const ___ConversationModelDeliverySchema: z.ZodType<ConversationModelDelivery> = z.object({
	physicalNonce: _hex,
	logicalFence: _hex,
	expectedRequestBodySha256: _hex.optional(),
}).strict();
