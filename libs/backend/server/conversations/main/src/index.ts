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
export { _CreateConversationReplayRepository } from "./db/prisma-conversation-replay.composition";
export { __CreateConversationReplayRouter } from "./conversation-replay.router";
export { _CreateSelfConversationReplayRouter } from "./db/prisma-self-conversation-replay.router";
export type { SelfConversationReplayCompositionOptions } from "./self-conversation-replay.router.types";
export type { ConversationAttachmentAdmissionFactory, ConversationAttachmentAdmissionPort } from "./conversation-message-admission.types";
export { _CreateSelfConversationsRouter } from "./db/prisma-self-conversations.router";
export { _SelfConversationReplayOpenapiPaths } from "./openapi";
export { _SelfConversationsOpenapiPaths } from "./openapi";
export type { AgentThreadParentDeliveryCommand, AgentThreadParentDeliveryRouterDependencies, AgentThreadParentDeliveryUnitOfWork, AgentThreadRuntimeIdentity, AgentThreadRuntimeIdentityReviewer, DeliverAgentThreadParentResult } from "./agent-thread-parent-delivery.types";
export { PrismaAgentThreadParentDeliveryUnitOfWork } from "./db/prisma-agent-thread-parent-delivery-unit-of-work";
export { __CreateAgentThreadParentDeliveryRouter } from "./agent-thread-parent-delivery.router";
