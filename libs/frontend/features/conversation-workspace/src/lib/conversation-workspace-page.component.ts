import { ChangeDetectionStrategy, Component, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";

import { A2uiCanvasComponent } from "@opencrane/elements/a2ui";
import { ConversationComposerComponent, ConversationMessageComponent, ConversationRichTextComponent, ConversationRunActionsComponent, ConversationStatusLineComponent } from "@opencrane/elements/conversation";
import { ConversationActivityComponent } from "@opencrane/features/conversation-activity";
import { ConversationAttachmentTrayComponent, ConversationFilesPanelComponent } from "@opencrane/features/conversation-assets";
import { ConversationElicitationCardComponent } from "@opencrane/features/conversation-elicitation";
import { ConversationAssetsStore } from "@opencrane/state/conversation/assets";
import { ConversationElicitationStore, type ConversationActivityTarget } from "@opencrane/state/conversation/elicitation";
import { ConversationWorkspaceStore } from "@opencrane/state/conversation/workspace";

import { ConversationCreateComponent } from "./conversation-create.component.js";
import { ConversationListComponent } from "./conversation-list.component.js";
import type { ConversationThreadNavigationIntent } from "./conversation-workspace-feature.types.js";
import { ConversationWorkspacePresenter } from "./conversation-workspace.presenter.js";

/** Thin route-ready workspace shell; the app owns URLs and provider implementation choices. */
@Component({ selector: "wo-conversation-workspace-page", standalone: true, imports: [A2uiCanvasComponent, ButtonModule, ConversationActivityComponent, ConversationAttachmentTrayComponent, ConversationComposerComponent, ConversationCreateComponent, ConversationElicitationCardComponent, ConversationFilesPanelComponent, ConversationListComponent, ConversationMessageComponent, ConversationRichTextComponent, ConversationRunActionsComponent, ConversationStatusLineComponent, MessageModule], templateUrl: "./conversation-workspace-page.component.html", styleUrl: "./conversation-workspace-page.component.scss", changeDetection: ChangeDetectionStrategy.OnPush, providers: [ConversationAssetsStore, ConversationElicitationStore, ConversationWorkspaceStore] })
export class ConversationWorkspacePageComponent extends ConversationWorkspacePresenter
{
	/** Requests app-owned navigation into one child Agent session. */
	public readonly threadRequested = output<ConversationThreadNavigationIntent>();

	/** Emit one exact child route intent from a parent message. */
	protected openThread(childConversationId: string, parentMessageId: string): void
	{
		const parentConversationId = this.store.selected()?.id;
		if (parentConversationId !== undefined) this.threadRequested.emit({ parentConversationId, childConversationId, parentMessageId });
	}

	/** Move focus to one Activity target already present in the selected page. */
	protected focusActivity(target: ConversationActivityTarget): void
	{
		const id = target.requestId ?? target.toolCallId;
		if (id !== undefined) globalThis.document.getElementById(id)?.focus();
	}
}
