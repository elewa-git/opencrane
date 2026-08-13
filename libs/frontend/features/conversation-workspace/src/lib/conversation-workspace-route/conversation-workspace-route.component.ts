import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, viewChild } from "@angular/core";
import { Router } from "@angular/router";

import { PLATFORM_BRIDGE, type AuthenticationWindowObservation } from "@opencrane/platform";

import type { ConversationThreadNavigationIntent } from "../conversation-workspace-feature.types.js";
import { ConversationWorkspacePageComponent } from "../components/conversation-workspace-page/conversation-workspace-page.component.js";
import { _ConversationRouteCommands, _ConversationThreadRouteNavigation } from "./conversation-workspace-route.state.js";

/** Feature-local coordinator for canonical chat URLs and breadcrumb child navigation. */
@Component({ selector: "wo-conversation-workspace-route", standalone: true, imports: [ConversationWorkspacePageComponent], templateUrl: "./conversation-workspace-route.component.html", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationWorkspaceRouteComponent
{
	/** Optional canonical conversation route coordinate. */
	public readonly conversationId = input<string>();
	/** Angular router used for feature-owned URL and browser-history mutations. */
	private readonly _router = inject(Router);
	/** Feature route lifetime used to stop observing a sign-in window. */
	private readonly _destroyRef = inject(DestroyRef);
	/** Runtime seam that owns browser or desktop authentication windows. */
	private readonly _platform = inject(PLATFORM_BRIDGE);
	/** Child page that reconciles its request after the runtime-owned sign-in window closes. */
	private readonly _page = viewChild.required(ConversationWorkspacePageComponent);
	/** Runtime-owned sign-in window currently being observed. */
	private _stepUpObservation: AuthenticationWindowObservation | null = null;

	/** Stop the popup observer when navigation destroys this route. */
	public constructor() { this._destroyRef.onDestroy(this._StopStepUpObserver.bind(this)); }

	/** Put an authorized participant selection in the canonical app URL. */
	protected async selectConversation(conversationId: string | null): Promise<void>
	{
		await this._router.navigate(_ConversationRouteCommands(conversationId));
	}

	/**
	 * Puts the plain workspace index in the address bar after the page switched to onboarding history.
	 *
	 * There is no URL for a completed onboarding exchange, and deliberately so: it is not a conversation,
	 * and its id is a browser key that no conversation route or API would accept. `/chats` is the right
	 * destination instead, because that route resolves the signed-in user's history projection on load —
	 * so reloading or sharing the address lands back on the same history without encoding it in the path.
	 *
	 * This also has to clear any conversation id left over from an earlier selection. If it did not, the
	 * `conversationId` route input would still name that conversation and the page would reopen it on top
	 * of the history the user just chose.
	 *
	 * Called by: the `(workspaceIndexSelected)` binding in this component's own template.
	 */
	protected async selectWorkspaceIndex(): Promise<void>
	{
		await this._router.navigate(["/chats"]);
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
		if (this._stepUpObservation !== null || path !== "/api/v1/auth/reauthenticate") return;
		this._stepUpObservation = this._platform.openAuthenticationWindow(path, this._RecoverAfterStepUp.bind(this));
	}

	/** Reconcile the existing request after the runtime reports the sign-in window closed. */
	private _RecoverAfterStepUp(): void
	{
		this._stepUpObservation = null;
		void this._page().recoverAfterStepUp();
	}

	/** Stop observing and forget browser references owned by this route. */
	private _StopStepUpObserver(): void
	{
		this._stepUpObservation?.stop();
		this._stepUpObservation = null;
	}
}
