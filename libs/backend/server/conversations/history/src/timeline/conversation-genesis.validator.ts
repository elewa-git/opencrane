import { ___GroupChildOriginSchema, type GroupChildOrigin } from "@opencrane/models/conversations";

/** Validates immutable child genesis without accepting self-parenting or malformed source coordinates. */
export function _ParseGroupChildOrigin(value: unknown, childConversationId: string): GroupChildOrigin | null
{
	const parsed = ___GroupChildOriginSchema.safeParse(value);
	return parsed.success && parsed.data.parentConversationId !== childConversationId ? parsed.data : null;
}
