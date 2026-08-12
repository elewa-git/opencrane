import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, afterRenderEffect, effect, input, output, signal } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";

import { ConversationComposerComponent, ConversationMessageComponent, ConversationRichTextComponent, ConversationRunActionsComponent, ConversationStatusLineComponent } from "@opencrane/elements/conversation";
import { ConversationActivityComponent } from "@opencrane/features/conversation-activity";
import { ConversationAttachmentTrayComponent, ConversationFilesPanelComponent } from "@opencrane/features/conversation-assets";
import { ConversationElicitationCardComponent } from "@opencrane/features/conversation-elicitation";
import { ConversationAssetsStore } from "@opencrane/state/conversation/assets";
import { ConversationElicitationStore, type ConversationActivityTarget } from "@opencrane/state/conversation/elicitation";
import { ConversationOnboardingHistoryStore, ConversationRunStore, ConversationWorkspaceRouteStates, ConversationWorkspaceStore } from "@opencrane/state/conversation/workspace";

import { ConversationCreateComponent } from "../conversation-create/conversation-create.component.js";
import { ConversationListComponent } from "../conversation-list/conversation-list.component.js";
import { ConversationOnboardingHistoryComponent } from "../components/conversation-onboarding-history/conversation-onboarding-history.component.js";
import type { ConversationThreadNavigationIntent } from "../conversation-workspace-feature.types.js";
import { ConversationWorkspacePresenter } from "../conversation-workspace.presenter.js";

/** Workspace screen; its feature route owns URL coordination while the app binds concrete gateways. */
@Component({ selector: "wo-conversation-workspace-page", standalone: true, imports: [ButtonModule, ConversationActivityComponent, ConversationAttachmentTrayComponent, ConversationComposerComponent, ConversationCreateComponent, ConversationElicitationCardComponent, ConversationFilesPanelComponent, ConversationListComponent, ConversationMessageComponent, ConversationOnboardingHistoryComponent, ConversationRichTextComponent, ConversationRunActionsComponent, ConversationStatusLineComponent, MessageModule], templateUrl: "./conversation-workspace-page.component.html", styleUrl: "./conversation-workspace-page.component.scss", changeDetection: ChangeDetectionStrategy.OnPush, providers: [ConversationAssetsStore, ConversationElicitationStore, ConversationOnboardingHistoryStore, ConversationRunStore, ConversationWorkspaceStore] })
export class ConversationWorkspacePageComponent extends ConversationWorkspacePresenter
{
	/** Optional app-owned route selection adopted after the workspace list loads. */
	public readonly conversationId = input<string | null>(null);
	/** Requests app-owned navigation into one child Agent session. */
	public readonly threadRequested = output<ConversationThreadNavigationIntent>();
	/** Reports participant selection so the app can own the canonical URL. */
	public readonly conversationSelected = output<string | null>();
	/** Reports onboarding-history selection so the app can restore the workspace index URL. */
	public readonly workspaceIndexSelected = output<void>();
	/** Requests app-owned verified sign-in without letting the feature navigate. */
	public readonly stepUpRequested = output<string>();
	/** Keeps a route selection and the component-scoped store aligned. */
	private readonly _routeSelectionEffect = effect(this._OpenRouteSelection.bind(this));
	/** Restores focus after the app reports that verified sign-in has completed. */
	private readonly _elicitationFocusEffect = afterRenderEffect(this._RestoreElicitationFocus.bind(this));
	/** Polite result of following an Activity deep link. */
	protected readonly activityAnnouncement = signal("");

	/** Move focus when Angular creates the access-change explanation. */
	@ViewChild("accessChangedHeading")
	private set _AccessChangedHeading(heading: ElementRef<HTMLHeadingElement> | undefined)
	{
		if (this.store.routeState() === ConversationWorkspaceRouteStates.AccessChanged && heading !== undefined) globalThis.queueMicrotask(function _FocusHeading() { heading.nativeElement.focus(); });
	}

	/** Open one rail selection before asking the app to update the URL. */
	protected async openConversation(conversationId: string): Promise<void>
	{
		await this.open(conversationId);
		if (this.store.selected()?.id === conversationId) this.conversationSelected.emit(conversationId);
	}

	/** Ask the app to select an authoritative newly created conversation. */
	protected async create(): Promise<void>
	{
		const navigation = await this.store.create();
		if (navigation === null) return;
		this.creating.set(false);
		this.conversationSelected.emit(navigation.conversationId);
	}

	/** Select the read-only onboarding exchange and restore the workspace index URL. */
	protected openOnboardingHistory(): void
	{
		this.store.openOnboardingHistory();
		if (this.store.onboardingHistorySelected()) this.workspaceIndexSelected.emit();
	}

	/** Ask the app to replace an archived selection with the next authorized row. */
	protected async archiveConversation(): Promise<void>
	{
		const navigation = await this.store.archive();
		if (navigation !== null) this.conversationSelected.emit(navigation.conversationId);
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

	/** Forward the fixed server-owned sign-in path to the app coordinator. */
	protected requestStepUp(path: string): void { this.stepUpRequested.emit(path); }

	/** Reconcile the request after the app's verified sign-in window closes. */
	public async recoverAfterStepUp(): Promise<void> { await this.elicitationStore.recoverAfterStepUp(); }

	/** Adopt only a route coordinate that differs from the selected authorized snapshot. */
	private _OpenRouteSelection(): void
	{
		const conversationId = this.conversationId();
		if (this.store.routeState() !== this.routeStates.Ready) return;
		if (conversationId !== null && this.store.selected()?.id !== conversationId) void this.open(conversationId);
	}

	/** Focus the original ask after recovery adopted its current server projection. */
	private _RestoreElicitationFocus(): void
	{
		if (this.elicitationStore.stepUpPath() !== null) return;
		const requestId = this.elicitationStore.restoreFocusRequestId();
		if (requestId === null) return;
		const target = globalThis.document.getElementById(requestId);
		if (target === null) return;
		target.scrollIntoView({ block: "center" });
		target.focus();
		this.elicitationStore.acknowledgeFocusRestored();
	}
}
