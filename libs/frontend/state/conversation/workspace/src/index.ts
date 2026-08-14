/**
 * Public entry point for the conversation workspace state package.
 *
 * Everything the workspace feature, the transport adapter and the app may use is listed here; a
 * consumer that reaches into `./lib/*` is bypassing the boundary this file draws.
 *
 * Some lines re-export from neighbouring packages — conversation models, the shared event-stream
 * adapter, AG-UI state — so one import covers the whole screen and this package stays the single place
 * a consumer looks up a workspace name. Each declaration keeps its own documentation, and hovering a
 * name here follows through to it.
 *
 * @see ../README.md for what this package owns and what it deliberately does not.
 */
export { CONVERSATION_WORKSPACE_EVENT_STREAM, CONVERSATION_WORKSPACE_GATEWAY } from "./lib/conversation-workspace.gateway";
export { ConversationWorkspaceGatewayError, ConversationWorkspaceGatewayErrorKinds } from "./lib/conversation-workspace-gateway.errors";
export { ConversationWorkspaceStore } from "./lib/conversation-workspace.store";
export { ConversationOnboardingHistoryStore } from "./lib/conversation-onboarding-history.store";
export { ConversationRunStore } from "./lib/conversation-run.store";
export { _ParseConversationDetail, _ParseConversationRun, _ParseConversationSummary, _ParseConversationWorkspaceDirectory } from "./lib/conversation-workspace.validator";
export { ConversationCreationStates, ConversationOnboardingHistoryStatuses, ConversationPersonalAgentStatuses, ConversationRunStates, ConversationWorkspaceRouteStates } from "./lib/conversation-workspace.types";
export { ConversationLifecycles, ConversationModes, MessageRoles, MessageSources, MessageStates } from "@opencrane/models/conversations";
export { ConversationEventStreamStatuses } from "@opencrane/state/conversation/adapter";
export { AgUiToolStatuses } from "@opencrane/state/conversation/ag-ui";
export type { ConversationCreationDirectory, ConversationDirectoryParticipant, ConversationMessage, ConversationOnboardingHistory, ConversationOnboardingHistoryEntry, ConversationOnboardingHistoryProjection, ConversationPersonalAgent, ConversationRun, ConversationSummary, ConversationWorkspaceDetail, ConversationWorkspaceGateway, ConversationWorkspaceNavigationIntent, CreateConversationCommand, RetryConversationRunCommand, SubmitConversationMessageBlock, SubmitConversationMessageCommand, SubmitConversationSteeringCommand } from "./lib/conversation-workspace.types";
