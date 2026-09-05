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
export { PrismaAgentSessionCreationUnitOfWork } from "./agent-session-creation";
export type { AgentSessionReleaseProfile, InitialConversationComputerResolver } from "./agent-session-creation.types";
export type { BoundConversationWriterAppend, BoundConversationWriterBinding, BoundConversationWriterClock, BoundConversationWriterLeaseFence, BoundConversationWriterRateLimiter, BoundConversationWriterVisibilityPolicy, ComputerConversationEntryDraft } from "./bound-conversation-writer.types";
export { __RunConversationComputerActivationListener } from "./conversation-computer-activation";
export type { ConversationComputerActivationAuthority, ConversationComputerActivationCommand, ConversationComputerActivationOutcome, ConversationComputerActivationParked, ConversationComputerActivationProjection, ConversationComputerActivationProjectionRepository, ConversationComputerActiveLeaseProjectionCommand } from "./conversation-computer-activation.types";
export { ConversationComputerActivationAuthorityAdapter } from "./conversation-computer-activation-authority";
export { ConversationComputerLifecycleAuthority } from "./conversation-computer-lifecycle";
export type { ConversationComputerAttemptActivity, ConversationComputerCheckpointStore, ConversationComputerClaimReleaser, ConversationComputerIdlePolicy, ConversationComputerLifecycleCommand, ConversationComputerLifecycleOutcome } from "./conversation-computer-lifecycle.types";
export { ConversationComputerCheckpointAuthority, _CheckpointArtifactId, _CheckpointRevisionId } from "./conversation-computer-checkpoint";
export type { ConversationComputerCheckpointCapture, ConversationComputerCheckpointCatalogue, ConversationComputerCheckpointFence, ConversationComputerCheckpointPolicy, ConversationComputerCheckpointReader, ConversationComputerCheckpointRestoreCommand, ConversationComputerCheckpointRestoreResult, ConversationComputerCheckpointSandbox, ConversationComputerCheckpointUploader } from "./conversation-computer-checkpoint.types";
export { _CreateConversationComputerCheckpointRouter } from "./conversation-computer-checkpoint.router";
export type { ConversationComputerCheckpointRestorer, ConversationComputerCheckpointRouterOptions } from "./conversation-computer-checkpoint.router.types";
export { ConversationComputerLifecycleScheduler, _LifecycleEventId } from "./conversation-computer-lifecycle-scheduler";
export type { ConversationComputerLifecycleCandidate, ConversationComputerLifecycleEnumerator, ConversationComputerLifecycleReconciler } from "./conversation-computer-lifecycle-scheduler.types";
export { ConversationComputerCheckpointFenceAdapter, ConversationComputerLifecycleDueEnumerator, ConversationComputerLifecycleWorker, HttpConversationComputerCheckpointSandbox } from "./conversation-computer-lifecycle-runtime";
export { PrismaConversationComputerActivationProjectionRepository } from "./db/prisma-conversation-computer-activation-repository";
export { PrismaConversationComputerLifecycleProjectionRepository } from "./db/prisma-conversation-computer-lifecycle-projection-repository";
export { _CreateConversationComputerTurnRouter } from "./conversation-computer-turn.router";
export type { ConversationComputerBootstrap, ConversationComputerBootstrapCommand, ConversationComputerModelCredential, ConversationComputerOutputCommand, ConversationComputerTurnAuthority, ConversationComputerTurnRouterOptions } from "./conversation-computer-turn.types";
export { ConversationComputerTurnAuthority as ConversationComputerTurnAuthorityService } from "./conversation-computer-turn-authority";
export { ActiveConversationComputerTurnCandidateResolver } from "./conversation-computer-turn-candidate-resolver";
export { KurrentConversationComputerTurnStore } from "./conversation-computer-turn-store";
export { PrismaConversationComputerTurnUnitOfWork } from "./db/prisma-conversation-computer-turn-unit-of-work";
export { PrismaConversationComputerCredentialUnitOfWork } from "./db/prisma-conversation-computer-credential-issuer";
export type { ConversationComputerBoundWriterFactory, ConversationComputerCredentialIssuer, ConversationComputerOutputPayloadStore, ConversationComputerPendingTurnCompiler, ConversationComputerPodBindingVerifier, ConversationComputerTurnAuthorityDependencies, ConversationComputerTurnCandidate, ConversationComputerTurnCandidateResolver, ConversationComputerTurnProjectionRepository, ConversationComputerTurnStore, FrozenConversationComputerTurn } from "./conversation-computer-turn.types";
export type { ConversationComputerRawCredentialAuthority } from "./conversation-computer-turn.types";
export { ConversationComputerHistory } from "./conversation-computers";
export type { ActiveConversationComputerLease, ConversationComputerAppendCommand, ConversationComputerCurrentCommand, CurrentConversationComputer } from "./conversation-computers";
export { AesGcmConversationPrivatePayloadCipher } from "./conversation-private-payload-cipher";
export type { ConversationPrivatePayloadCipher, ConversationPrivatePayloadKeyringDocument } from "./conversation-private-payload.types";
export { _SelfConversationHistoryOpenapiPaths } from "./openapi";
export { PrismaSelfConversationHistoryUnitOfWork } from "./prisma-self-conversation-history";
export { ConversationHistoryAuthority } from "./conversation-history-authority";
export { _CreateSelfConversationHistoryRouter } from "./self-conversation-history.router";
export { ConversationMessageActivations, ConversationMessageAdmissionOutcomes } from "./self-conversation-history.types";
export type { ConversationCallerResolver, ConversationMessageAdmissionResult, ConversationMessageCommand, SelfConversationHistoryAuthority, SelfConversationHistoryResult } from "./self-conversation-history.types";
export { PrismaConversationMetadataUnitOfWork } from "./prisma-conversation-metadata";
export { _CreateConversationMetadataRouter } from "./conversation-metadata.router";
export type { ConversationMetadataAuthority, ConversationMetadataDetail, ConversationMetadataSummary, ConversationReviewCoordinates } from "./conversation-metadata.types";
export { _ConversationComputerReviewAuthority } from "./review/conversation-computer-review-authority";
export { _CreateConversationComputerReviewRouter } from "./review/conversation-computer-review.router";
export type { ConversationComputerReviewAuthority, ConversationComputerReviewCaller, ConversationComputerReviewPrincipalResolver, ConversationComputerReviewRoute, ConversationComputerReviewRouterOptions } from "./review/conversation-computer-review.types";
