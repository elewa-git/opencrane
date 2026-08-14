import { Location } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from "@angular/core";
import { Router } from "@angular/router";

import type { A2uiSurfacePresentation } from "@opencrane/elements/a2ui";
import type { ConversationAssetPresentation } from "@opencrane/features/conversation-assets";
import type { AgentThreadParentRestoreIntent, AgentThreadSummaryTarget } from "@opencrane/state/conversation/agent-threads";
import type { ConversationActivityRow, ConversationElicitation } from "@opencrane/state/conversation/elicitation";

import type { AgentThreadProjectionPurgeIntent } from "./agent-thread-feature.types";
import { AgentThreadPageComponent } from "./agent-thread-page.component";
import { _AgentThreadHistoryAfterPurge, _PurgedAgentThreadRouteProjection } from "./agent-thread-route.state";
import type { AgentThreadRouteHistoryState } from "./agent-thread-route.state.types";

/**
 * Hosts the Agent-thread child conversation at `chats/:parentConversationId/threads/:childConversationId`.
 *
 * This class and {@link AgentThreadPageComponent} split one screen along a single line: the route
 * component owns the URL and the browser history entry, and the page plus its `AgentThreadStore` own
 * every piece of child state. So the route reads the two path parameters, reads the restoration and
 * focus coordinates the parent workspace left in `history.state`, hands both down as inputs, and
 * answers the three intents the page emits back: go to the parent, use the safe `/chats` fallback,
 * and drop
 * everything about a purged child. It never calls a gateway and never decides a child state, so the
 * application only has to mount this feature behind its access guard.
 *
 * It also holds the child projections that belong to other feature packages (Activity rows,
 * elicitation, asset, A2UI surface). Those are empty in this build: no producer wires them yet, and
 * the page renders the timeline from its own store. They exist so the purge path already covers them.
 *
 * You reach this by opening the child URL: from the parent group chat's Agent-thread summary once #351
 * ships, or by hand today. Either way `___OperatorAccessGuard` has already confirmed a signed-in
 * session, and the server still decides whether this reader may see the child.
 *
 * Called by: apps/opencrane-ui/src/app/app.routes.ts through the feature package's public barrel,
 * as the lazy component behind the `chats/:parentConversationId/threads/:childConversationId` path.
 * @see AgentThreadRouteHistoryState for what the parent workspace is expected to leave in history.
 */
@Component({ selector: "wo-agent-thread-route", standalone: true, imports: [AgentThreadPageComponent], templateUrl: "./agent-thread-route.component.html", changeDetection: ChangeDetectionStrategy.OnPush })
export class AgentThreadRouteComponent
{
	/** Parent group conversation id, filled from the `:parentConversationId` path segment. */
	public readonly parentConversationId = input.required<string>();
	/**
	 * Child Agent-session conversation id, filled from the `:childConversationId` path segment.
	 *
	 * Both inputs arrive without any code reading `ActivatedRoute`, because the app calls
	 * `provideRouter(APP_ROUTES, withComponentInputBinding())` in app.config.ts.
	 */
	public readonly childConversationId = input.required<string>();
	/** Router used for the one navigation this class performs, to the safe `/chats` fallback. */
	private readonly _router = inject(Router);
	/** Angular browser-history seam used without reaching for a raw runtime global from the feature. */
	private readonly _location = inject(Location);
	/**
	 * Snapshot of the browser history entry this route was opened with.
	 *
	 * Read once while Angular creates the component, and rewritten only by `purgeChildProjection`,
	 * which keeps this field in step with the entry it just replaced.
	 */
	private _history = this._location.getState() as AgentThreadRouteHistoryState;
	/**
	 * Highest purge generation this route has already applied; 0 means it has applied none.
	 *
	 * The store raises its generation both when it loses access to a child and when it moves to another
	 * parent/child pair, so several purges can arrive during one visit. Applying only a higher number
	 * keeps each purge to a single history rewrite and makes a re-delivered intent a no-op.
	 */
	private _purgeGeneration = 0;
	/** Activity rows for the child. Nothing writes them yet; #351 owns the workspace that will. */
	protected readonly activityRows = signal<readonly ConversationActivityRow[]>([]);
	/** Open question or approval for the child. Nothing writes it yet; #351 owns that composition. */
	protected readonly elicitation = signal<ConversationElicitation | null>(null);
	/** File shown alongside the child timeline. Nothing writes it yet; #351 owns that composition. */
	protected readonly asset = signal<ConversationAssetPresentation | null>(null);
	/** A2UI surface for the child. Nothing writes it yet; #351 owns that composition. */
	protected readonly a2uiSurface = signal<A2uiSurfacePresentation | null>(null);
	/**
	 * Timeline entry the page should focus, seeded from history and writable so a purge can clear it.
	 *
	 * Clearing it matters: once access to the child is gone, the reader must not be sent back to a
	 * position inside content they may no longer see.
	 */
	private readonly _focusTarget = signal<AgentThreadSummaryTarget | null>(this._history.focusTarget ?? null);
	/**
	 * Parent restoration coordinate, or null when history holds none for the parent in the current URL.
	 *
	 * Recomputes when the route parameter changes. A purge does not invalidate it, because the purge
	 * deliberately leaves `parentRestore` in the history entry as the reader's way back.
	 */
	protected readonly parentRestore = computed(this._ParentRestore.bind(this));
	/** Read-only view of {@link AgentThreadRouteComponent._focusTarget} passed down to the page. */
	protected readonly focusTarget = this._focusTarget.asReadonly();

	/**
	 * Sends the reader back to the parent message they came from, using the browser's own back step.
	 *
	 * Going back reuses the history entry the parent workspace created, so the parent regains the scroll
	 * position and focus it recorded there; a forward navigation would push a new entry and lose it.
	 * That only holds while the entry below this one really is that parent, so an intent naming a
	 * different parent uses the `/chats` fallback instead of stepping somewhere unrelated.
	 * @param intent - Parent coordinate and restoration anchors emitted by the page.
	 */
	protected restoreParent(intent: AgentThreadParentRestoreIntent): void
	{
		if (intent.parentConversationId !== this.parentConversationId()) { void this.openChats(); return; }
		this._location.back();
	}

	/**
	 * Navigates to `/chats`, which redirects to onboarding until the durable chat workspace ships.
	 *
	 * The page asks for this from its "Chats" breadcrumb, and `restoreParent` and
	 * `AgentThreadPageComponent.returnToParent` fall through to it. `/chats` says nothing about which
	 * conversations exist, so it is also the right landing place after access to a child is revoked.
	 */
	protected async openChats(): Promise<void> { await this._router.navigateByUrl("/chats"); }

	/**
	 * Clears everything this route holds about the child once the store reports it purged its own state.
	 *
	 * The store purges when a reader loses access to a child they were already shown, and when the route
	 * moves to a different pair. Either way the projections composed here and the remembered focus
	 * position have to go in the same turn, or a revoked child keeps showing content and stays re-openable
	 * at that position.
	 * @param intent - Purge generation plus the parent/child pair the store was showing when it purged.
	 */
	protected purgeChildProjection(intent: AgentThreadProjectionPurgeIntent): void
	{
		// 1. Skip a purge already applied, so a re-delivered intent cannot rewrite history a second time.
		if (intent.generation <= this._purgeGeneration) return;

		// 2. Skip a purge for another route: the page may still be emitting for the pair it just left,
		// and clearing the current child's state on its behalf would blank a screen the reader can see.
		if (intent.parentConversationId !== this.parentConversationId() || intent.childConversationId !== this.childConversationId()) return;

		// 3. Record the generation before clearing, so a repeat of this same intent stops at step 1.
		this._purgeGeneration = intent.generation;

		// 4. Clear all five child-derived values from one emptied projection, never field by field.
		const purged = _PurgedAgentThreadRouteProjection();
		this.activityRows.set(purged.activityRows);
		this.elicitation.set(purged.elicitation);
		this.asset.set(purged.asset);
		this.a2uiSurface.set(purged.a2uiSurface);
		this._focusTarget.set(purged.focusTarget);

		// 5. Drop the focus target from the history entry too, keeping the router's keys and the parent
		// return path, then hold the same object so `parentRestore` reads what the browser now has.
		const retainedHistory = _AgentThreadHistoryAfterPurge(this._location.getState());
		this._location.replaceState(this._location.path(true), "", retainedHistory);
		this._history = retainedHistory;
	}

	/**
	 * Accepts a restoration coordinate from history only when it names the parent in the current URL.
	 *
	 * A history entry can outlive the route that wrote it, and a reader can arrive at this child from
	 * a different parent, so an unchecked coordinate would send them back into an unrelated conversation.
	 * @returns The restoration coordinate for this parent, or null when history holds none that matches.
	 */
	private _ParentRestore(): AgentThreadParentRestoreIntent | null
	{
		const restore = this._history.parentRestore;
		return restore?.parentConversationId === this.parentConversationId() ? restore : null;
	}

}
