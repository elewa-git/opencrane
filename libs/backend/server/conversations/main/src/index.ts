/**
 * Public entry point for `@opencrane/backend/server/conversations`.
 *
 * Only what an app composition root needs is exported: ready-to-mount routers, the
 * KurrentDB-backed history and computer authorities, their Prisma projection adapters, the
 * OpenAPI path fragments, and the few port types an app must implement or pass through. Everything
 * else — the entry validators, the redaction step, the private-payload codec — stays
 * package-private, so the history and redaction rules can only be changed inside this package.
 *
 * Imported by: the apps/opencrane/src/app composition modules (routes.ts, conversation-history-composition.ts,
 * conversation-computer-activation-composition.ts, conversation-computer-lifecycle-composition.ts,
 * conversation-computer-turn-composition.ts, run-admission-composition.ts), the run-input authority in
 * libs/backend/agents/execution/inputs, and libs/backend/server/api-spec (the conversation OpenAPI fragment).
 */
export { BoundConversationWriter } from "./bound-conversation-writer";
export { PrismaAgentSessionCreationUnitOfWork } from "./agent-session-creation";
export type { AgentSessionReleaseProfile, InitialConversationComputerResolver } from "./agent-session-creation.types";
export type { BoundConversationWriterAppend, BoundConversationWriterBinding, BoundConversationWriterClock, BoundConversationWriterLeaseFence, BoundConversationWriterRateLimiter, BoundConversationWriterVisibilityPolicy, ComputerConversationEntryDraft } from "./bound-conversation-writer.types";
export { __RunConversationComputerActivationListener, __StartConversationComputerActivationConsumer } from "./conversation-computer-activation";
export { ConversationComputerActivationConsumerEventKinds, ConversationComputerActivationConsumerStates, ConversationComputerActivationQueueActions } from "./conversation-computer-activation.types";
export type { ConversationComputerActivationAuthority, ConversationComputerActivationCommand, ConversationComputerActivationConsumer, ConversationComputerActivationConsumerEvent, ConversationComputerActivationConsumerHealth, ConversationComputerActivationConsumerOptions, ConversationComputerActivationListenerOptions, ConversationComputerActivationOutcome, ConversationComputerActivationParked, ConversationComputerActivationPending, ConversationComputerActivationProjection, ConversationComputerActivationProjectionRepository, ConversationComputerActivationResubscribePolicy, ConversationComputerActiveLeaseProjectionCommand } from "./conversation-computer-activation.types";
export { ConversationComputerActivationAuthorityAdapter } from "./conversation-computer-activation-authority";
export { KurrentConversationComputerActivityReader, _ConversationComputerActiveTurnStreamName } from "./conversation-computer-activity";
export type { ConversationComputerActivity, ConversationComputerActivityCommand, ConversationComputerActivityReader } from "./conversation-computer-activity.types";
export { ConversationComputerLifecycleAuthority } from "./conversation-computer-lifecycle";
export type { ConversationComputerAttemptActivity, ConversationComputerCheckpointStore, ConversationComputerIdlePolicy, ConversationComputerLeaseProjectionCommand, ConversationComputerLifecycleCommand, ConversationComputerLifecycleOutcome, ConversationComputerSandboxClaims } from "./conversation-computer-lifecycle.types";
export { _CreateConversationComputerOperatorRouter } from "./conversation-computer-operator.router";
export type { ConversationComputerActivationReplayer, ConversationComputerOperatorAuthorization, ConversationComputerOperatorCaller, ConversationComputerOperatorPrincipalResolver, ConversationComputerOperatorRouterOptions } from "./conversation-computer-operator.router.types";
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
export type { ConversationComputerBootstrap, ConversationComputerBootstrapCommand, ConversationComputerModelCredential, ConversationComputerOutputCommand, ConversationComputerReviewCredentialGrant, ConversationComputerTurnAuthority, ConversationComputerTurnRouterOptions } from "./conversation-computer-turn.types";
export { ConversationComputerTurnAuthority as ConversationComputerTurnAuthorityService } from "./conversation-computer-turn-authority";
export { ActiveConversationComputerTurnCandidateResolver } from "./conversation-computer-turn-candidate-resolver";
export { KurrentConversationComputerTurnStore } from "./conversation-computer-turn-store";
export { PrismaConversationComputerTurnUnitOfWork } from "./db/prisma-conversation-computer-turn-unit-of-work";
export { PrismaConversationComputerCredentialUnitOfWork } from "./db/prisma-conversation-computer-credential-issuer";
export type { ConversationComputerBoundWriterFactory, ConversationComputerCredentialIssuer, ConversationComputerOutputPayloadStore, ConversationComputerPendingTurnCompiler, ConversationComputerPodBindingVerifier, ConversationComputerPrePersistedMessageInput, ConversationComputerRunAdmissionCommand, ConversationComputerRunAdmissionPort, ConversationComputerTurnAuthorityDependencies, ConversationComputerTurnCandidate, ConversationComputerTurnCandidateResolver, ConversationComputerTurnCompileAnchor, ConversationComputerTurnCoordinates, ConversationComputerTurnProjectionRepository, ConversationComputerTurnStore, FrozenConversationComputerTurn } from "./conversation-computer-turn.types";
export type { ConversationComputerRawCredentialAuthority } from "./conversation-computer-turn.types";
export { ConversationComputerHistory } from "./conversation-computers";
export type { ActiveConversationComputerLease, ConversationComputerAppendCommand, ConversationComputerCurrentCommand, CurrentConversationComputer } from "./conversation-computers";
export { AesGcmConversationPrivatePayloadCipher } from "./conversation-private-payload-cipher";
export type { ConversationPrivatePayloadCipher, ConversationPrivatePayloadKeyringDocument } from "./conversation-private-payload.types";
export { _SelfConversationHistoryOpenapiPaths } from "./openapi";
export { PrismaSelfConversationHistoryUnitOfWork } from "./prisma-self-conversation-history";
export { ConversationHistoryAuthority } from "./conversation-history-authority";
export { KurrentConversationHistoryAdmissionReader } from "./kurrent-conversation-history-admission-reader";
export { PrismaKurrentConversationPromptMessageRepository } from "./db/prisma-kurrent-conversation-prompt-message-repository";
export { _CreateSelfConversationHistoryRouter } from "./self-conversation-history.router";
export { ConversationMessageActivations, ConversationMessageAdmissionOutcomes } from "./self-conversation-history.types";
export type { ConversationCallerResolver, ConversationMessageAdmissionResult, ConversationMessageCommand, SelfConversationHistoryAuthority, SelfConversationHistoryResult } from "./self-conversation-history.types";
export { PrismaConversationMetadataUnitOfWork } from "./prisma-conversation-metadata";
export { _CreateConversationMetadataRouter } from "./conversation-metadata.router";
export type { ConversationMetadataAuthority, ConversationMetadataDetail, ConversationMetadataSummary, ConversationReviewCoordinates } from "./conversation-metadata.types";
export { _ConversationComputerReviewAuthority } from "./review/conversation-computer-review-authority";
export { KeyedConversationComputerReviewCredentialDeriver } from "./review/conversation-computer-review-credential";
export { _CreateConversationComputerReviewRouter } from "./review/conversation-computer-review.router";
export type { ConversationComputerReviewAuthority, ConversationComputerReviewCaller, ConversationComputerReviewCredentialCoordinates, ConversationComputerReviewCredentialDeriver, ConversationComputerReviewPrincipalResolver, ConversationComputerReviewRoute, ConversationComputerReviewRouterOptions } from "./review/conversation-computer-review.types";
