/**
 * Public entry point for the conversation workspace state package.
 *
 * Everything the workspace feature, the transport adapter and the app may use is listed here; a
 * consumer that reaches into `./lib/*` is bypassing the boundary this file draws.
 *
 * Some lines re-export from neighbouring packages — conversation models and the shared history-stream
 * contract — so one import covers the whole screen and this package stays the single place
 * a consumer looks up a workspace name. Each declaration keeps its own documentation, and hovering a
 * name here follows through to it.
 *
 * @see ../README.md for what this package owns and what it deliberately does not.
 */
export { CONVERSATION_COMPUTER_REVIEW_GATEWAY, CONVERSATION_WORKSPACE_EVENT_STREAM, CONVERSATION_WORKSPACE_GATEWAY } from "./lib/conversation-workspace.gateway";
export { ConversationWorkspaceGatewayError, ConversationWorkspaceGatewayErrorKinds } from "./lib/conversation-workspace-gateway.errors";
export { ConversationWorkspaceStore } from "./lib/conversation-workspace.store";
export { ConversationPersonalRunsStore } from "./lib/conversation-personal-runs.store";
export { CONVERSATION_PERSONAL_RUNS_GATEWAY, ConversationPersonalRunStates } from "./lib/conversation-personal-runs.types";
export type { ConversationPersonalRun, ConversationPersonalRunsGateway, ConversationWorkStopCommand } from "./lib/conversation-personal-runs.types";
export { _ParseConversationPersonalRuns } from "./lib/conversation-personal-runs.validator";
export { ConversationComputerReviewStore } from "./lib/conversation-computer-review.store";
export { ConversationOnboardingHistoryStore } from "./lib/conversation-onboarding-history.store";
export { _ParseConversationDetail, _ParseConversationSummary, _ParseConversationWorkspaceDirectory } from "./lib/conversation-workspace.validator";
export { ConversationCreationStates, ConversationOnboardingHistoryStatuses, ConversationPersonalAgentStatuses, ConversationWorkspaceRouteStates } from "./lib/conversation-workspace.types";
export { ConversationLifecycles, ConversationModes, MessageRoles, MessageSources, MessageStates } from "@opencrane/models/conversations";
export { ConversationEventStreamStatuses } from "@opencrane/state/conversation/stream";
export type { ConversationComputerBrowserTarget, ConversationComputerCommandResult, ConversationComputerReviewGateway, ConversationCreationDirectory, ConversationDirectoryParticipant, ConversationOnboardingHistory, ConversationOnboardingHistoryEntry, ConversationOnboardingHistoryProjection, ConversationPersonalAgent, ConversationSummary, ConversationWorkspaceDetail, ConversationWorkspaceGateway, ConversationWorkspaceNavigationIntent, CreateConversationCommand, SubmitConversationMessageCommand } from "./lib/conversation-workspace.types";

export { CONVERSATION_CURRENT_SUBJECT, CONVERSATION_GROUP_CHILD_GATEWAY } from "./lib/conversation-workspace.gateway";
export { ConversationGroupChildStore } from "./lib/conversation-group-child.store";
export { ConversationGroupCommandStates } from "./lib/conversation-group-child.types";
export type { ConversationCompanyAssistant, ConversationGroupSource, ConversationGroupChildGateway } from "./lib/conversation-group-child.types";
export { _ParseConversationGroupChildren, _ParseConversationGroupChild, _ParseConversationGroupShare } from "./lib/conversation-group-response.validator";
