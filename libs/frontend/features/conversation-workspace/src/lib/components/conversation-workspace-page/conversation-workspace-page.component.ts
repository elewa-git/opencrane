import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, afterRenderEffect, effect, input, output, signal } from "@angular/core";
import { ConversationAssetsStore } from "@opencrane/state/conversation/assets";
import { ConversationElicitationStore, type ConversationActivityTarget } from "@opencrane/state/conversation/elicitation";
import { ConversationOnboardingHistoryStore, ConversationRunStore, ConversationWorkspaceRouteStates, ConversationWorkspaceStore } from "@opencrane/state/conversation/workspace";

import { ConversationSessionRailItemKinds, type ConversationSessionRailSelectionIntent, type ConversationThreadNavigationIntent } from "../../conversation-workspace-feature.types";
import { ConversationWorkspacePresenter } from "../../conversation-workspace.presenter";
import { CONVERSATION_WORKSPACE_PAGE_IMPORTS } from "./conversation-workspace-page.imports";

/**
 * Composes the chat workspace and reports navigation intent to its feature route; the app binds the
 * concrete gateways used by its component-scoped stores.
 *
 * The main area shows one of three things, and the template picks between them in that order: the
	 * completed onboarding dialogue, the selected conversation, or an empty-state prompt. The visually
	 * unified session rail does not change those separate server-backed sources. The page also owns the
	 * transient context-panel visibility because closing Activity or Files is a local layout preference,
	 * not durable conversation state.
 *
 * Every store it needs is listed in `providers`, so each one is created per page instance and destroyed
 * with it. That includes the onboarding history store: its transcript and selection belong to this
 * screen and must not outlive it.
 *
 * Called by: feature-local `ConversationWorkspaceRouteComponent`, which owns the child chat URLs.
 */
@Component({ selector: "wo-conversation-workspace-page", standalone: true, imports: CONVERSATION_WORKSPACE_PAGE_IMPORTS, templateUrl: "./conversation-workspace-page.component.html", styleUrl: "./conversation-workspace-page.component.scss", changeDetection: ChangeDetectionStrategy.OnPush, providers: [ConversationAssetsStore, ConversationElicitationStore, ConversationOnboardingHistoryStore, ConversationRunStore, ConversationWorkspaceStore] })
export class ConversationWorkspacePageComponent extends ConversationWorkspacePresenter
{
	/** Optional app-owned route selection adopted after the workspace list loads. */
	public readonly conversationId = input<string | null>(null);
	/** Requests app-owned navigation into one child Agent session. */
	public readonly threadRequested = output<ConversationThreadNavigationIntent>();
	/** Reports participant selection so the app can own the canonical URL. */
	public readonly conversationSelected = output<string | null>();
	/**
	 * Fires when the workspace has switched to the onboarding history, so the app can put the plain
	 * workspace index in the address bar.
	 *
	 * It carries no id because history is not a conversation and has no URL of its own. The app answers
	 * this by navigating to `/chats`, which clears any conversation id left in the URL from a previous
	 * selection — otherwise the route input would keep pointing at that conversation and the page would
	 * reopen it over the history the user just chose.
	 */
	public readonly workspaceIndexSelected = output<void>();
	/** Requests app-owned verified sign-in without letting the feature navigate. */
	public readonly stepUpRequested = output<string>();
	/** Keeps a route selection and the component-scoped store aligned. */
	private readonly _routeSelectionEffect = effect(this._OpenRouteSelection.bind(this));
	/** Restores focus after the app reports that verified sign-in has completed. */
	private readonly _elicitationFocusEffect = afterRenderEffect(this._RestoreElicitationFocus.bind(this));
	/** Polite result of following an Activity deep link. */
	protected readonly activityAnnouncement = signal("");
	/** Whether the selected ordinary conversation's Activity and Files context is visible. */
	protected readonly contextPanelOpen = signal(true);
	/** Header trigger that receives focus after the context panel closes. */
	@ViewChild("contextPanelToggle")
	private _contextPanelToggle: ElementRef<HTMLButtonElement> | undefined;

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

	/** Delegate one visually unified rail selection to its real server-backed source. */
	protected async selectSession(intent: ConversationSessionRailSelectionIntent): Promise<void>
	{
		switch (intent.kind)
		{
			case ConversationSessionRailItemKinds.Onboarding: this.openOnboardingHistory(); return;
			case ConversationSessionRailItemKinds.Conversation:
				if (intent.conversationId !== null) await this.openConversation(intent.conversationId);
				return;
		}
	}

	/** Ask the app to select an authoritative newly created conversation. */
	protected async create(): Promise<void>
	{
		const navigation = await this.store.create();
		if (navigation === null) return;
		this.creating.set(false);
		this.conversationSelected.emit(navigation.conversationId);
	}

	/**
	 * Asks the store to switch to the onboarding history, then tells the app to update the URL.
	 *
	 * The store refuses the switch unless it holds a completed transcript, and it refuses silently, so
	 * the emit is guarded by reading the selection back rather than by assuming the call worked. Without
	 * that guard a rail press during an unavailable history read would still rewrite the URL and drop the
	 * conversation the user was reading.
	 */
	protected openOnboardingHistory(): void
	{
		this.store.openOnboardingHistory();
		if (this.store.onboardingHistorySelected()) this.workspaceIndexSelected.emit();
	}

	/** Reopen the selected conversation's context without changing its durable selection. */
	protected openContextPanel(): void { this.contextPanelOpen.set(true); }

	/** Close the context panel and return keyboard focus to its persistent header trigger. */
	protected closeContextPanel(): void
	{
		this.contextPanelOpen.set(false);
		const trigger = this._contextPanelToggle;
		if (trigger !== undefined) globalThis.queueMicrotask(function _RestoreContextToggleFocus() { trigger.nativeElement.focus(); });
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
