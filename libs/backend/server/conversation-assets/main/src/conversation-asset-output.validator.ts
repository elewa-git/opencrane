// This validator owns the untrusted runtime JSON boundary beside its output model so fields cannot drift from transport parsing.
import { z, type ZodType } from "zod";

import { ___DecideConversationAssetBatch } from "@opencrane/models/conversation-assets";
import { ___IsSha256ContentAddress } from "@opencrane/models/artifacts";

import type { ReserveConversationAssetOutput } from "./conversation-asset-output.types.js";

/** Strict runtime reservation schema; semantic media and total-byte policy remains in the authority. */
const _ReserveConversationAssetOutputSchema: ZodType<ReserveConversationAssetOutput> = z.object({
	runId: z.string().trim().min(1).max(256),
	runAttempt: z.number().int().min(1),
	messageId: z.string().trim().min(1).max(256),
	idempotencyKey: z.string().trim().min(1).max(128),
	displayName: z.string().trim().min(1).max(255),
	mediaType: z.string().trim().min(1).max(255),
	byteLength: z.number().int().positive().safe(),
	contentAddress: z.string().refine(___IsSha256ContentAddress),
}).strict().refine(function _ApprovedSingleOutput(command) { return ___DecideConversationAssetBatch([{ mediaType: command.mediaType, byteLength: command.byteLength }]).accepted; });

/** Parse one untrusted runtime reservation without throwing across the HTTP boundary. */
export function _ParseReserveConversationAssetOutput(value: unknown): ReserveConversationAssetOutput | null
{
	const result = _ReserveConversationAssetOutputSchema.safeParse(value);
	return result.success ? result.data : null;
}
