import { ChangeDetectionStrategy, Component, ElementRef, effect, input, output, signal, viewChild } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";

import { ConversationComposerComponent, ConversationMessageComponent, ConversationRichTextComponent, ConversationRunActionsComponent, ConversationStatusLineComponent } from "@opencrane/elements/conversation";
import { ConversationActivityComponent } from "@opencrane/features/conversation-activity";
import { ConversationAttachmentTrayComponent, ConversationFilesPanelComponent } from "@opencrane/features/conversation-assets";
import { ConversationElicitationCardComponent } from "@opencrane/features/conversation-elicitation";
import { ConversationAssetsStore } from "@opencrane/state/conversation/assets";
import { ConversationElicitationStore, type ConversationActivityTarget } from "@opencrane/state/conversation/elicitation";
import { ConversationRunStore, ConversationWorkspaceRouteStates, ConversationWorkspaceStore } from "@opencrane/state/conversation/workspace";

import { ConversationCreateComponent } from "./conversation-create.component.js";
import { ConversationListComponent } from "./conversation-list.component.js";
import type { ConversationThreadNavigationIntent } from "./conversation-workspace-feature.types.js";
import { ConversationWorkspacePresenter } from "./conversation-workspace.presenter.js";

/** Thin route-ready workspace shell; the app owns URLs and provider implementation choices. */
@Component({ selector: "wo-conversation-workspace-page", standalone: true, imports: [ButtonModule, ConversationActivityComponent, ConversationAttachmentTrayComponent, ConversationComposerComponent, ConversationCreateComponent, ConversationElicitationCardComponent, ConversationFilesPanelComponent, ConversationListComponent, ConversationMessageComponent, ConversationRichTextComponent, ConversationRunActionsComponent, ConversationStatusLineComponent, MessageModule], templateUrl: "./conversation-workspace-page.component.html", styleUrl: "./conversation-workspace-page.component.scss", changeDetection: ChangeDetectionStrategy.OnPush, providers: [ConversationAssetsStore, ConversationElicitationStore, ConversationRunStore, ConversationWorkspaceStore] })
export class ConversationWorkspacePageComponent extends ConversationWorkspacePresenter
{
	/** Optional app-owned route selection adopted after the workspace list loads. */
	public readonly conversationId = input<string | null>(null);
	/** Requests app-owned navigation into one child Agent session. */
	public readonly threadRequested = output<ConversationThreadNavigationIntent>();
	/** Reports participant selection so the app can own the canonical URL. */
	public readonly conversationSelected = output<string>();
	/** Keeps a route selection and the component-scoped store aligned. */
	private readonly _routeSelectionEffect = effect(this._OpenRouteSelection.bind(this));
	/** Access-change heading rendered after private conversation state is purged. */
	private readonly _accessChangedHeading = viewChild<ElementRef<HTMLHeadingElement>>("accessChangedHeading");
	/** Moves keyboard focus to the access-change explanation when it appears. */
	private readonly _accessChangedFocusEffect = effect(this._FocusAccessChangedHeading.bind(this));
	/** Polite result of following an Activity deep link. */
	protected readonly activityAnnouncement = signal("");

	/** Open one rail selection before asking the app to update the URL. */
	protected async openConversation(conversationId: string): Promise<void>
	{
		await this.open(conversationId);
		if (this.store.selected()?.id === conversationId) this.conversationSelected.emit(conversationId);
	}

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
		if (id === undefined) return;
		const destination = globalThis.document.getElementById(id);
		if (destination === null)
		{
			this.activityAnnouncement.set("That activity is no longer available in this conversation.");
			return;
		}
		destination.scrollIntoView({ block: "center", behavior: "smooth" });
		destination.focus();
		this.activityAnnouncement.set("Opened the selected activity in the conversation.");
	}

	/** Adopt only a route coordinate that differs from the selected authorized snapshot. */
	private _OpenRouteSelection(): void
	{
		const conversationId = this.conversationId();
		if (this.store.routeState() !== this.routeStates.Ready) return;
		if (conversationId !== null && this.store.selected()?.id !== conversationId) void this.open(conversationId);
	}

	/** Focus the access-change heading after Angular places it in the page. */
	private _FocusAccessChangedHeading(): void
	{
		const heading = this._accessChangedHeading();
		if (this.store.routeState() === ConversationWorkspaceRouteStates.AccessChanged && heading !== undefined) heading.nativeElement.focus();
	}
}
