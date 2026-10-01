import { ConversationWorkspaceComposerComponent } from "../conversation-workspace-composer/conversation-workspace-composer.component";
import { ConversationWorkspaceTranscriptComponent } from "../conversation-workspace-transcript/conversation-workspace-transcript.component";
import { ConversationWorkspaceHeaderComponent } from "../conversation-workspace-header/conversation-workspace-header.component";
import type { Type } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { ConversationElicitationCardComponent } from "@opencrane/features/conversation-elicitation";


import { ConversationCreateComponent } from "../conversation-create/conversation-create.component";
import { ConversationListComponent } from "../conversation-list/conversation-list.component";
import { ConversationOnboardingHistoryComponent } from "../conversation-onboarding-history/conversation-onboarding-history.component";
import { ConversationWorkspaceContextPanelComponent } from "../conversation-workspace-context-panel/conversation-workspace-context-panel.component";

import { ConversationGroupRequestComponent } from "../conversation-group-request/conversation-group-request.component";
import { ConversationGroupShareComponent } from "../conversation-group-share/conversation-group-share.component";

/** Declarative Angular imports rendered by the conversation workspace page template. */
export const CONVERSATION_WORKSPACE_PAGE_IMPORTS: Type<unknown>[] =
[
	ConversationWorkspaceComposerComponent,
	ConversationWorkspaceTranscriptComponent,
	ConversationWorkspaceHeaderComponent,
	ConversationElicitationCardComponent,
	ConversationGroupRequestComponent,
	ConversationGroupShareComponent,
	ButtonModule,
	ConversationCreateComponent,
	ConversationListComponent,
	ConversationOnboardingHistoryComponent,
	ConversationWorkspaceContextPanelComponent,
];
