// This validator owns the untrusted participant reservation beside its model so HTTP and authority checks cannot drift.
import { z, type ZodType } from "zod";

import { ___DecideConversationAssetBatch } from "@opencrane/models/conversation-assets";
import { ___IsSha256ContentAddress } from "@opencrane/models/artifacts";

import type { ReserveConversationAssetRequest } from "./conversation-asset.types.js";

/** Strict participant upload reservation shape shared by transport and durable authority. */
const _ReserveConversationAssetSchema: ZodType<ReserveConversationAssetRequest> = z.object({
	idempotencyKey: z.string().trim().min(1).max(128),
	displayName: z.string().trim().min(1).max(255),
	mediaType: z.string().trim().min(1).max(255),
	byteLength: z.number().int().positive().safe(),
	contentAddress: z.string().refine(___IsSha256ContentAddress),
}).strict().refine(function _ApprovedSingleUpload(request) { return ___DecideConversationAssetBatch([{ mediaType: request.mediaType, byteLength: request.byteLength }]).accepted; });

/** Parse one untrusted participant reservation without throwing across a transport boundary. */
export function _ParseReserveConversationAsset(value: unknown): ReserveConversationAssetRequest | null
{
	const result = _ReserveConversationAssetSchema.safeParse(value);
	return result.success ? result.data : null;
}
