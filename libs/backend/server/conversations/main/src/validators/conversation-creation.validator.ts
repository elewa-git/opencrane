/**
 * Guards the trust boundary between an HTTP request body and the conversation create path.
 *
 * Everything checked here arrives from a browser, so nothing in it is trusted yet. This is the
 * first place the body is looked at, and it is where the shape is settled, because
 * `__CreateSelfConversationsRouter` hands the parsed value straight to the database layer and that
 * layer must never have to guess which fields a client did or did not send.
 *
 * Two properties are what make the boundary hold. The request may only name people and Agents by
 * the opaque references the `/directory` endpoint handed out — an org-membership row id or an
 * AgentService id, never an OIDC subject or a login name — so a caller cannot address a user whose
 * membership the directory did not show them. And every branch is `.strict()`, so an unknown field
 * is a rejection rather than something ignored: a body carrying its own `siloId` is answered 400
 * and never reaches `create`, which is what stops a client picking the silo its conversation lands
 * in. That case is pinned by "rejects caller-supplied authority coordinates" in
 * `__tests__/self-conversations.router.test.ts`.
 *
 * The references themselves are still unproven after this file. They are resolved against current
 * membership and personal-Agent ownership inside the write transaction, in
 * `PrismaConversationMutationRepository._creationAuthority`, which is also where a duplicate
 * reference and the caller's own reference are refused. Nothing here can tell whether a reference
 * exists, and it deliberately does not try.
 *
 * @see PrismaConversationMutationRepository — resolves these references to real subjects.
 * @see ___ConversationCreationRequestSchema in `@opencrane/models/conversations` — the same
 * per-mode participant rules over internal user ids, for values already inside the server.
 */

import { z } from "zod";

import { ConversationModes } from "@opencrane/models/conversations";

import type { CreateConversationRequest } from "../types/conversation-request.types";

/**
 * One opaque reference from the creation directory: an org-membership row id, or an AgentService
 * id. The length cap is a size limit on untrusted input, not a format check — real ids are much
 * shorter, and whether the reference names anything is decided later in the write transaction.
 */
const _ReferenceSchema = z.string().trim().min(1).max(128);

/**
 * Agent-session creation names the caller's own personal Agent and no participants.
 *
 * The reference is checked in the write transaction against the single Active personal
 * AgentService built from the caller's approved persona revision, so naming somebody else's Agent
 * here is refused there rather than here.
 */
const _AgentSessionSchema = z.object({ mode: z.literal(ConversationModes.AgentSession), personalAgentRef: _ReferenceSchema }).strict();

/**
 * Direct creation names exactly one other person. The caller is added by the server and is not
 * listed, so a length of one means a two-person conversation.
 */
const _DirectSchema = z.object({ mode: z.literal(ConversationModes.Direct), participantRefs: z.array(_ReferenceSchema).length(1) }).strict();

/**
 * Group creation names one to ninety-nine other people, again excluding the caller, giving a
 * hundred participants at most. The same one-to-ninety-nine rule is stated over internal user ids
 * by `_GroupCreationSchema` in `libs/models/conversations/main/src/conversation.validator.ts`, so
 * the HTTP boundary and the model agree on the cap.
 */
const _GroupSchema = z.object({ mode: z.literal(ConversationModes.Group), participantRefs: z.array(_ReferenceSchema).min(1).max(99) }).strict();

/**
 * Checks a create-conversation body and decides which mode it is asking for.
 *
 * `mode` is the discriminator, so a body gets exactly the participant rule for the mode it names
 * and cannot mix them — an agent session carrying `participantRefs` fails, because a conversation's
 * mode is fixed for its whole life and there is no API that changes it afterwards.
 *
 * Called by: `__CreateSelfConversationsRouter` in `self-conversations.router.ts`, on
 * `POST /api/v1/me/conversations`. A failed parse becomes 400 `invalid_conversation_request` and
 * the authority is never called; a successful parse is passed on as {@link CreateConversationRequest}.
 *
 * @see CreateConversationRequest — the type this schema is declared to produce, so a new mode
 * added there fails to compile until it has a branch here.
 */
export const _ConversationCreationRequestSchema: z.ZodType<CreateConversationRequest> = z.discriminatedUnion("mode", [_AgentSessionSchema, _DirectSchema, _GroupSchema]);
