/**
 * Public entry point for `@opencrane/backend/server/conversations`.
 *
 * Only what an app composition root needs is exported: ready-to-mount routers, the
 * Prisma-backed replay reader, the production clock and limits, the OpenAPI path fragments, and
 * the few port types an app must implement or pass through. Everything else — the authority
 * ports, the redaction step, the cursor codec, the Prisma adapters — stays package-private, so
 * the streaming and redaction rules can only be changed inside this package.
 *
 * Imported by: apps/opencrane/src/app/routes.ts (`_CreateSelfConversationsRouter`,
 * `_CreateSelfConversationReplayRouter`), apps/opencrane/src/app/runtime-composition.ts
 * (`__CreateConversationReplayRouter`, `_CreateConversationReplayRepository`,
 * `CONVERSATION_LIVE_REPLAY_CLOCK`, `CONVERSATION_LIVE_REPLAY_LIMITS`), and
 * libs/backend/server/api-spec (the two OpenAPI fragments).
 */
export { _CreateConversationReplayRepository } from "./prisma-conversation-replay.composition.js";
export { __CreateConversationReplayRouter } from "./conversation-replay.router.js";
export { _CreateSelfConversationReplayRouter } from "./prisma-self-conversation-replay.router.js";
export type { SelfConversationReplayCompositionOptions } from "./self-conversation-replay.router.types.js";
export type { ConversationAttachmentAdmissionFactory, ConversationAttachmentAdmissionPort } from "./conversation-message-admission.types.js";
export { _CreateSelfConversationsRouter } from "./prisma-self-conversations.router.js";
export { _SelfConversationReplayOpenapiPaths } from "./openapi.js";
export { _SelfConversationsOpenapiPaths } from "./openapi.js";
