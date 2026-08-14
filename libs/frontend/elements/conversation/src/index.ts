// Public API of @opencrane/elements/conversation.
//
// Every component here only DISPLAYS one presentation object and emits an intent output; none of
// them calls a gateway or decides whether an action is allowed. ConversationRunActionsComponent,
// for example, emits retryRequested, cancelRequested, and steerRequested, and the host page turns
// those into server calls — so hiding a button here never protects a run, and the server still
// re-checks every retry.
//
// The one host today is ConversationWorkspacePageComponent in
// libs/frontend/features/conversation-workspace, which owns the stores and the gateway.
//
// ConversationRichTextComponent renders the HTML string it is handed and sanitizes nothing itself.
// Today that string comes from _ConversationMessageView in conversation-workspace.mapper.ts, which
// builds it with toSanitizedMarkdownHtml/toStreamingMarkdownHtml (DOMPurify) from
// @opencrane/state/conversation/render. A new host must run the same renderer.
export { ConversationComposerComponent } from "./lib/conversation-composer/conversation-composer.component";
export { ConversationMessageComponent } from "./lib/conversation-message/conversation-message.component";
export { ConversationStatusLineComponent } from "./lib/conversation-status-line/conversation-status-line.component";
export { ConversationRichTextComponent } from "./lib/conversation-rich-text/conversation-rich-text.component";
export { ConversationRunActionsComponent } from "./lib/conversation-run-actions/conversation-run-actions.component";
export { ConversationComposerStates, ConversationMessageTones, ConversationStatusTones } from "./lib/conversation.types";
export type { ConversationMessagePresentation, ConversationRichTextPresentation, ConversationRunActionsPresentation, ConversationStatusPresentation } from "./lib/conversation.types";
