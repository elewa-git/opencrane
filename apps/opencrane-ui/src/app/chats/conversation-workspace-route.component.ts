import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, viewChild } from "@angular/core";
import { Router } from "@angular/router";

import { ConversationWorkspacePageComponent, type ConversationThreadNavigationIntent } from "@opencrane/features/conversation-workspace";

import { _ConversationRouteCommands, _ConversationThreadRouteNavigation } from "./conversation-workspace-route.state.js";

/** Thin app coordinator for canonical chat URLs and breadcrumb child navigation. */
@Component({ selector: "wo-conversation-workspace-route", standalone: true, imports: [ConversationWorkspacePageComponent], templateUrl: "./conversation-workspace-route.component.html", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationWorkspaceRouteComponent
{
	/** Optional canonical conversation route coordinate. */
	public readonly conversationId = input<string>();
	/** App router owns URL and browser-history mutations. */
	private readonly _router = inject(Router);
	/** App route lifetime used to stop observing a sign-in window. */
	private readonly _destroyRef = inject(DestroyRef);
	/** Child page that reconciles its request after the app-owned sign-in window closes. */
	private readonly _page = viewChild.required(ConversationWorkspacePageComponent);
	/** App-owned sign-in popup currently being observed. */
	private _stepUpWindow: Window | null = null;
	/** Bounded browser timer used only while the sign-in popup remains open. */
	private _stepUpTimer: ReturnType<typeof setInterval> | null = null;

	/** Stop the popup observer when navigation destroys this route. */
	public constructor() { this._destroyRef.onDestroy(this._StopStepUpObserver.bind(this)); }

	/** Put an authorized participant selection in the canonical app URL. */
	protected async selectConversation(conversationId: string | null): Promise<void>
	{
		await this._router.navigate(_ConversationRouteCommands(conversationId));
	}

	/** Open one child Agent session with exact parent breadcrumb restoration state. */
	protected async openThread(intent: ConversationThreadNavigationIntent): Promise<void>
	{
		const navigation = _ConversationThreadRouteNavigation(intent);
		await this._router.navigate(navigation.commands, navigation.extras);
	}

	/** Open the fixed server-owned sign-in path without giving the feature navigation authority. */
	protected startStepUp(path: string): void
	{
		if (this._stepUpWindow !== null || path !== "/api/v1/auth/reauthenticate") return;
		const popup = globalThis.open(path, "opencrane-step-up", "popup,width=560,height=720");
		if (popup === null) return;
		this._stepUpWindow = popup;
		this._stepUpTimer = setInterval(this._ObserveStepUpWindow.bind(this), 250);
	}

	/** Reconcile the existing request after the verified sign-in window closes. */
	private _ObserveStepUpWindow(): void
	{
		if (this._stepUpWindow?.closed !== true) return;
		this._StopStepUpObserver();
		void this._page().recoverAfterStepUp();
	}

	/** Stop observing and forget browser references owned by this route. */
	private _StopStepUpObserver(): void
	{
		if (this._stepUpTimer !== null) clearInterval(this._stepUpTimer);
		this._stepUpTimer = null;
		this._stepUpWindow = null;
	}
}
