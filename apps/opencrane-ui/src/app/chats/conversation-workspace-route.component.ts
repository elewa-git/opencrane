import { ChangeDetectionStrategy, Component, inject, input } from "@angular/core";
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

	/** Put an authorized participant selection in the canonical app URL. */
	protected async selectConversation(conversationId: string): Promise<void>
	{
		await this._router.navigate(_ConversationRouteCommands(conversationId));
	}

	/** Open one child Agent session with exact parent breadcrumb restoration state. */
	protected async openThread(intent: ConversationThreadNavigationIntent): Promise<void>
	{
		const navigation = _ConversationThreadRouteNavigation(intent);
		await this._router.navigate(navigation.commands, navigation.extras);
	}
}
