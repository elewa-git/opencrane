import { z } from "zod";

import { GroupChildStates, type GroupChildOrigin, type GroupChildView } from "./group-child.types";

/** Accepts an opaque coordinate without rewriting the server's value. */
const _Identifier = z.string().min(1).max(1024).refine(value => value.trim() === value);
/** Accepts an existing message revision within the unsigned 64-bit stream range. */
const _Position = z.string().regex(/^[1-9][0-9]{0,19}$/u).refine(value => /^[1-9][0-9]{0,19}$/u.test(value) && BigInt(value) <= 18_446_744_073_709_551_615n);

/** Checks a child's origin; an enclosing conversation must also reject itself as the parent. */
export const ___GroupChildOriginSchema = z.object({ requestId: z.string().uuid(), parentConversationId: _Identifier, parentMessageId: z.string().uuid(), parentMessagePosition: _Position }).strict();

/** Checks the public child request and rejects a conversation that names itself as its parent. */
export const ___GroupChildViewSchema = z.object({ conversationId: _Identifier, parentConversationId: _Identifier, parentMessageId: z.string().uuid(), parentMessagePosition: _Position, state: z.nativeEnum(GroupChildStates), agentName: z.string().trim().min(1).max(500) }).strict().refine(value => value.conversationId !== value.parentConversationId);

/** Validates a child request before a transport consumer adopts it. @throws ZodError for an invalid projection. */
export function ___ParseGroupChildView(value: unknown): GroupChildView { return ___GroupChildViewSchema.parse(value); }

/** Validates saved origin coordinates without granting access to the parent. @throws ZodError for an invalid origin. */
export function ___ParseGroupChildOrigin(value: unknown): GroupChildOrigin { return ___GroupChildOriginSchema.parse(value); }
