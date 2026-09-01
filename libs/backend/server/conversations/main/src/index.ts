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
export { _CreateConversationReplayRepository } from "./db/prisma-conversation-replay.composition";
export { __CreateConversationReplayRouter } from "./conversation-replay.router";
export { __CreateConversationComputerRuntimeBootstrapRouter } from "./conversation-computer-runtime-bootstrap.router";
export type { ConversationComputerRuntimeBootstrapClock, ConversationComputerRuntimeBootstrapHistory, ConversationComputerRuntimeBootstrapResponse, ConversationComputerRuntimeBootstrapRouterDependencies, ConversationComputerRuntimeIdentity, ConversationComputerRuntimeIdentityReviewer } from "./conversation-computer-runtime-bootstrap.router.types";
export { __CreateSelfConversationSocketServer } from "./self-conversation-socket";
export type { SelfConversationSocketAuthenticator, SelfConversationSocketDependencies, SelfConversationSocketServer } from "./self-conversation-socket.types";
export type { ConversationAttachmentAdmissionFactory, ConversationAttachmentAdmissionPort } from "./conversation-message-admission.types";
export { _CreateSelfConversationsRouter } from "./db/prisma-self-conversations.router";
export { _CreatePrismaSelfConversationSocketServer } from "./db/prisma-self-conversations.router";
export { _SelfConversationsOpenapiPaths } from "./openapi";
export type { AgentThreadParentDeliveryCommand, AgentThreadParentDeliveryRouterDependencies, AgentThreadParentDeliveryUnitOfWork, AgentThreadRuntimeIdentity, AgentThreadRuntimeIdentityReviewer, DeliverAgentThreadParentResult } from "./agent-thread-parent-delivery.types";
export { PrismaAgentThreadParentDeliveryUnitOfWork } from "./db/prisma-agent-thread-parent-delivery-unit-of-work";
export { __CreateAgentThreadParentDeliveryRouter } from "./agent-thread-parent-delivery.router";
export { BoundConversationWriter } from "./bound-conversation-writer";
export type { BoundConversationWriterAppend, BoundConversationWriterBinding, BoundConversationWriterClock, BoundConversationWriterLeaseFence, BoundConversationWriterRateLimiter, BoundConversationWriterVisibilityPolicy, ComputerConversationEntryDraft } from "./bound-conversation-writer.types";
export { __RunConversationComputerActivationListener } from "./conversation-computer-activation";
export type { ConversationComputerActivationAuthority, ConversationComputerActivationCommand, ConversationComputerActivationOutcome, ConversationComputerActivationParked } from "./conversation-computer-activation.types";
export { ConversationComputerActivationClaimAuthority } from "./conversation-computer-activation-authority";
export type { ConversationComputerActivationAuthorityDependencies, ConversationComputerActivationClock, ConversationComputerActivationProfile, ConversationComputerActivationProfileCommand, ConversationComputerActivationProfileResolver } from "./conversation-computer-activation-authority.types";
export { ConversationComputerSandboxReconciliationAuthority } from "./conversation-computer-sandbox-reconciliation-authority";
export { ConversationComputerSandboxReconciliationOutcomes } from "./conversation-computer-sandbox-reconciliation-authority.types";
export type { ConversationComputerSandboxReconciliationAuthorityDependencies, ConversationComputerSandboxReconciliationOutcome } from "./conversation-computer-sandbox-reconciliation-authority.types";
export { ConversationComputerElicitationInterruptReader, ConversationComputerExecutionAuthority, ConversationComputerExecutionStartOutcomes, ConversationComputerHistory } from "./conversation-computers";
export type { ActiveConversationComputerExecution, ActiveConversationComputerLease, ActiveConversationComputerServerCommand, ConversationComputerActivationCurrentCommand, ConversationComputerAppendCommand, ConversationComputerCurrentCommand, ConversationComputerElicitationInterruptClock, ConversationComputerElicitationInterruptExecutionResolver, ConversationComputerElicitationInterruptParticipantResolver, ConversationComputerElicitationInterruptPayloadReader, ConversationComputerExecutionClock, ConversationComputerExecutionStartCommand, ConversationComputerExecutionStartResult, CurrentConversationComputer, DisplayedConversationComputerElicitationRequest } from "./conversation-computers";
