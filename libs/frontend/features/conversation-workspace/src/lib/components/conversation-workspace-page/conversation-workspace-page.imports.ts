import type { Type } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";

import { ConversationComposerComponent, ConversationMessageComponent, ConversationRichTextComponent } from "@opencrane/elements/conversation";

import { ConversationCreateComponent } from "../conversation-create/conversation-create.component";
import { ConversationListComponent } from "../conversation-list/conversation-list.component";
import { ConversationOnboardingHistoryComponent } from "../conversation-onboarding-history/conversation-onboarding-history.component";
import { ConversationWorkspaceContextPanelComponent } from "../conversation-workspace-context-panel/conversation-workspace-context-panel.component";
import { ConversationWorkspaceConnectionStatusComponent } from "../conversation-workspace-connection-status/conversation-workspace-connection-status.component";

import { ConversationGroupMessageActionsComponent } from "../conversation-group-message-actions/conversation-group-message-actions.component";
import { ConversationGroupRequestComponent } from "../conversation-group-request/conversation-group-request.component";
import { ConversationGroupShareComponent } from "../conversation-group-share/conversation-group-share.component";

/** Declarative Angular imports rendered by the conversation workspace page template. */
export const CONVERSATION_WORKSPACE_PAGE_IMPORTS: Type<unknown>[] =
[
	ConversationGroupMessageActionsComponent,
	ConversationGroupRequestComponent,
	ConversationGroupShareComponent,
	ButtonModule,
	MessageModule,
	ConversationComposerComponent,
	ConversationCreateComponent,
	ConversationListComponent,
	ConversationMessageComponent,
	ConversationOnboardingHistoryComponent,
	ConversationWorkspaceContextPanelComponent,
	ConversationWorkspaceConnectionStatusComponent,
	ConversationRichTextComponent
];
