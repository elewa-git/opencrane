import { z } from "zod";

import { ConversationModes } from "@opencrane/models/conversations";

import type { CreateConversationRequest } from "./conversation-authority.types.js";

/** Opaque reference issued by the authenticated creation directory. */
const _ReferenceSchema = z.string().trim().min(1).max(128);

/** Agent-session creation accepts only the caller's projected personal Agent reference. */
const _AgentSessionSchema = z.object({ mode: z.literal(ConversationModes.AgentSession), personalAgentRef: _ReferenceSchema }).strict();

/** Direct creation accepts one other active organisation membership reference. */
const _DirectSchema = z.object({ mode: z.literal(ConversationModes.Direct), participantRefs: z.array(_ReferenceSchema).length(1) }).strict();

/** Group creation accepts one to ninety-nine other active organisation membership references. */
const _GroupSchema = z.object({ mode: z.literal(ConversationModes.Group), participantRefs: z.array(_ReferenceSchema).min(1).max(99) }).strict();

/** Validates the self-scoped creation request without accepting raw login identifiers. */
export const _ConversationCreationRequestSchema: z.ZodType<CreateConversationRequest> = z.discriminatedUnion("mode", [_AgentSessionSchema, _DirectSchema, _GroupSchema]);
