import { z } from "zod";

import { ___GroupChildViewSchema, type GroupChildView } from "@opencrane/models/conversations";

/** Requires an explicit child list; an absent field must not silently become an empty list. */
const _Children = z.object({ children: z.array(___GroupChildViewSchema) }).strict();
/** Requires the accepted child request rather than trusting an arbitrary successful response. */
const _Child = z.object({ child: ___GroupChildViewSchema }).strict();
/** Accepts the existing message-admission acknowledgement after a reviewed human share. */
const _Share = z.object({ outcome: z.enum(["accepted", "idempotent"]), position: z.string().regex(/^[1-9][0-9]{0,19}$/u).refine(value => /^[1-9][0-9]{0,19}$/u.test(value) && BigInt(value) <= 18_446_744_073_709_551_615n) }).strict();

/** Checks child reads against the requested parent before the browser adopts them. @throws ZodError for malformed or foreign children. */
export function _ParseConversationGroupChildren(value: unknown, parentConversationId: string): readonly GroupChildView[]
{
	return _Children.refine(response => response.children.every(child => child.parentConversationId === parentConversationId)).parse(value).children;
}

/** Checks admission against both selected source coordinates before opening its child. @throws ZodError for mismatched admission. */
export function _ParseConversationGroupChild(value: unknown, parentConversationId: string, parentMessageId: string, parentMessagePosition: string): GroupChildView
{
	return _Child.refine(response => response.child.parentConversationId === parentConversationId && response.child.parentMessageId === parentMessageId && response.child.parentMessagePosition === parentMessagePosition).parse(value).child;
}

/** Requires an accepted or idempotent human share acknowledgement. @throws ZodError for an invalid result. */
export function _ParseConversationGroupShare(value: unknown): void { _Share.parse(value); }
