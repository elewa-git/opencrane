/**
 * Public entry point for `@opencrane/backend/server/conversations`.
 *
 * Only what an app composition root needs is exported: ready-to-mount routers, the
 * Prisma-backed replay reader, the production clock and limits, the OpenAPI path fragments, and
 * the few port types an app must implement or pass through. Everything else — the authority
 * ports, the redaction step, the cursor codec, the Prisma adapters — stays package-private, so
 * the streaming and redaction rules can only be changed inside this package.
 *
 * Imported by: apps/opencrane/src/index.ts (`_CreatePrismaSelfConversationSocketServer`),
 * apps/opencrane/src/app/routes.ts (`_CreateSelfConversationsRouter`), and apps/opencrane/src/app/runtime-composition.ts
 * (`__CreateConversationReplayRouter`, `_CreateConversationReplayRepository`,
 * `CONVERSATION_LIVE_REPLAY_CLOCK`, `CONVERSATION_LIVE_REPLAY_LIMITS`), and
 * libs/backend/server/api-spec (the conversation OpenAPI fragment).
 */
export { BoundConversationWriter } from "./bound-conversation-writer";
export type { BoundConversationWriterAppend, BoundConversationWriterBinding, BoundConversationWriterClock, BoundConversationWriterLeaseFence, BoundConversationWriterRateLimiter, BoundConversationWriterVisibilityPolicy, ComputerConversationEntryDraft } from "./bound-conversation-writer.types";
export { __RunConversationComputerActivationListener } from "./conversation-computer-activation";
export type { ConversationComputerActivationAuthority, ConversationComputerActivationCommand, ConversationComputerActivationOutcome, ConversationComputerActivationParked } from "./conversation-computer-activation.types";
export { ConversationComputerHistory } from "./conversation-computers";
export type { ActiveConversationComputerLease, ConversationComputerAppendCommand, ConversationComputerCurrentCommand, CurrentConversationComputer } from "./conversation-computers";
