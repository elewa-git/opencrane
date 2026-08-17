import type { Type } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";

import { ConversationComposerComponent, ConversationMessageComponent, ConversationRichTextComponent, ConversationRunActionsComponent, ConversationStatusLineComponent } from "@opencrane/elements/conversation";
import { ConversationAttachmentTrayComponent } from "@opencrane/features/conversation-assets";
import { ConversationElicitationCardComponent } from "@opencrane/features/conversation-elicitation";

import { ConversationCreateComponent } from "../conversation-create/conversation-create.component";
import { ConversationListComponent } from "../conversation-list/conversation-list.component";
import { ConversationOnboardingHistoryComponent } from "../conversation-onboarding-history/conversation-onboarding-history.component";
import { ConversationWorkspaceContextPanelComponent } from "../conversation-workspace-context-panel/conversation-workspace-context-panel.component";

/** Declarative Angular imports rendered by the conversation workspace page template. */
export const CONVERSATION_WORKSPACE_PAGE_IMPORTS: Type<unknown>[] =
[
	ButtonModule,
	MessageModule,
	ConversationAttachmentTrayComponent,
	ConversationComposerComponent,
	ConversationCreateComponent,
	ConversationElicitationCardComponent,
	ConversationListComponent,
	ConversationMessageComponent,
	ConversationOnboardingHistoryComponent,
	ConversationWorkspaceContextPanelComponent,
	ConversationRichTextComponent,
	ConversationRunActionsComponent,
	ConversationStatusLineComponent
];
