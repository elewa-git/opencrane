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
export type { ConversationComputerRuntimeBootstrapResponse } from "./conversation-computer-runtime-bootstrap.router.types";
export { __CreateConversationComputerRuntimeCommandRouter } from "./conversation-computer-runtime-command.router";
export type { ConversationComputerRuntimeCommandRouterDependencies } from "./conversation-computer-runtime-command.router.types";
export { __CreateConversationComputerRuntimeOutputRouter } from "./conversation-computer-runtime-output.router";
export type { ConversationComputerRuntimeOutputAuthorityPort, ConversationComputerRuntimeOutputRouterDependencies } from "./conversation-computer-runtime-output.router.types";
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
export { PrismaConversationPrivatePayloadStoreUnitOfWork } from "./db/prisma-conversation-private-payload-store-unit-of-work";
export { PrismaConversationComputerParticipantInputAuthorizerUnitOfWork } from "./db/prisma-conversation-computer-participant-input-authorizer-unit-of-work";
export { ConversationHistoryReader } from "./conversation-history-reader";
export { __RunConversationComputerActivationListener } from "./conversation-computer-activation";
export type { ConversationComputerActivationAuthority, ConversationComputerActivationCommand, ConversationComputerActivationOutcome, ConversationComputerActivationParked } from "./conversation-computer-activation.types";
export { ConversationComputerActivationClaimAuthority } from "./conversation-computer-activation-authority";
export type { ConversationComputerActivationAuthorityDependencies, ConversationComputerActivationClock, ConversationComputerActivationProfile, ConversationComputerActivationProfileCommand, ConversationComputerActivationProfileResolver } from "./conversation-computer-activation-authority.types";
export { ConversationComputerCreationActivationAuthority } from "./conversation-computer-creation-activation-authority";
export type { ConversationComputerCreationActivationAuthorityDependencies, ConversationComputerCreationActivationAuthority as ConversationComputerCreationActivationAuthorityPort, ConversationComputerCreationActivationClock } from "./conversation-computer-creation-activation-authority.types";
export { ConversationComputerAgentServiceKinds } from "./conversation-computer-profile-selection.types";
export type { ConversationComputerAgentServiceKind, ConversationComputerProfileSelectionCommand, ConversationComputerProfileSelector } from "./conversation-computer-profile-selection.types";
export { PrismaConversationAgentBindingUnitOfWork } from "./db/prisma-conversation-agent-binding-unit-of-work";
export { ConversationAgentBindingResolver } from "./conversation-agent-binding-authority";
export type { ConversationAgentBinding, ConversationAgentBindingAuthority as ConversationAgentBindingAuthorityPort, ConversationAgentBindingAuthorityDependencies, ConversationAgentBindingCommand, ConversationAgentBindingResult, ConversationAgentIdentitySelectionCommand, ConversationAgentIdentitySelector, ConversationManagedAgentPrincipalValidator } from "./conversation-agent-binding.types";
export { ConversationAgentBindingDenialReasons } from "./conversation-agent-binding.types";
export { HistoryAnchoredConversationCreationService } from "./conversation-creation-authority";
export type { ConversationCreationAuthority, ConversationCreationAuthorityDependencies, ConversationCreationAuthorityResult, ConversationCreationClock, HistoryAnchoredConversationCreationAuthorityFactory } from "./conversation-creation-authority.types";
export { PrismaConversationCreationCompilerUnitOfWork } from "./db/prisma-conversation-creation-compiler-unit-of-work";
export { PrismaConversationCreationProjectionUnitOfWork } from "./db/prisma-conversation-creation-projection-unit-of-work";
export { PrismaConversationCreationReservationUnitOfWork } from "./db/prisma-conversation-creation-reservation-unit-of-work";
export { ConversationCreationAnchorVerifier } from "./conversation-creation-anchor-verifier";
export { ConversationHistoryAuthority } from "./conversation-history-authority";
export { HistoryAnchoredConversationCreationAuthority } from "./history-anchored-conversation-creation-authority";
export { ConversationComputerSandboxReconciliationAuthority } from "./conversation-computer-sandbox-reconciliation-authority";
export { ConversationComputerSandboxReconciliationOutcomes } from "./conversation-computer-sandbox-reconciliation-authority.types";
export type { ConversationComputerSandboxReconciliationAuthorityDependencies, ConversationComputerSandboxReconciliationOutcome } from "./conversation-computer-sandbox-reconciliation-authority.types";
export { ConversationComputerElicitationInterruptReader, ConversationComputerExecutionAuthority, ConversationComputerExecutionStartOutcomes, ConversationComputerHistory, ConversationComputerParticipantInputAdmission, ConversationComputerParticipantInputAuthority, ConversationComputerParticipantInputDispatchAuthority, ConversationComputerParticipantInputOutcomes, ConversationComputerRuntimeCommandAuthority, ConversationComputerRuntimeOutputAuthority } from "./conversation-computers";
export type { ActiveConversationComputerExecution, ActiveConversationComputerLease, ActiveConversationComputerServerCommand, AuthorizedConversationComputerParticipantInput, ConversationComputerActivationCurrentCommand, ConversationComputerAppendCommand, ConversationComputerCurrentCommand, ConversationComputerElicitationInterruptClock, ConversationComputerElicitationInterruptExecutionResolver, ConversationComputerElicitationInterruptParticipantResolver, ConversationComputerElicitationInterruptPayloadReader, ConversationComputerExecutionClock, ConversationComputerExecutionStartCommand, ConversationComputerExecutionStartResult, ConversationComputerParticipantInputAdmissionResult, ConversationComputerParticipantInputAuthor, ConversationComputerParticipantInputAuthorityDependencies, ConversationComputerParticipantInputAuthorizer, ConversationComputerParticipantInputClock, ConversationComputerParticipantInputCommand, ConversationComputerParticipantInputDispatchAuthorityDependencies, ConversationComputerParticipantInputDispatchCommand, ConversationComputerParticipantInputDispatchResult, ConversationComputerParticipantInputEntry, ConversationComputerParticipantInputPayloadStore, ConversationComputerParticipantInputRequest, ConversationComputerParticipantInputResult, ConversationComputerProvisionAndActivationCommand, ConversationComputerRuntimeCommandAuthorityDependencies, ConversationComputerRuntimeCommandClock, ConversationComputerRuntimeCommandCompleteCommand, ConversationComputerRuntimeCommandCurrentCommand, ConversationComputerRuntimeCommandIssueResult, ConversationComputerRuntimeCommandNextIssueResult, ConversationComputerRuntimeNextStartTurnIssueCommand, ConversationComputerRuntimeOutputAuthorityDependencies, ConversationComputerRuntimeOutputClaim, ConversationComputerRuntimeOutputClaimAuthority, ConversationComputerRuntimeOutputClaimCommand, ConversationComputerRuntimeOutputClock, ConversationComputerRuntimeOutputPayloadStore, ConversationComputerRuntimeOutputResult, ConversationComputerRuntimeStartTurnCandidate, ConversationComputerRuntimeStartTurnIssueCommand, CurrentConversationComputer, DisplayedConversationComputerElicitationRequest } from "./conversation-computers";
