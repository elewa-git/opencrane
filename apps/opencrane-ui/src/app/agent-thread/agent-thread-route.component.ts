import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from "@angular/core";
import { Router } from "@angular/router";

import type { A2uiSurfacePresentation } from "@opencrane/elements/a2ui";
import { AgentThreadPageComponent, type AgentThreadProjectionPurgeIntent } from "@opencrane/features/agent-threads";
import type { ConversationAssetPresentation } from "@opencrane/features/conversation-assets";
import type { AgentThreadParentRestoreIntent, AgentThreadSummaryTarget } from "@opencrane/state/conversation/agent-threads";
import type { ConversationActivityRow, ConversationElicitation } from "@opencrane/state/conversation/elicitation";

import { _AgentThreadHistoryAfterPurge, _PurgedAgentThreadRouteProjection, type AgentThreadRouteHistoryState } from "./agent-thread-route.state";

/** Thin production coordinator for the canonical child route and browser-history restoration. */
@Component({ selector: "wo-agent-thread-route", standalone: true, imports: [AgentThreadPageComponent], templateUrl: "./agent-thread-route.component.html", changeDetection: ChangeDetectionStrategy.OnPush })
export class AgentThreadRouteComponent
{
	/** Canonical parent route parameter bound by Angular Router. */
	public readonly parentConversationId = input.required<string>();
	/** Canonical child route parameter bound by Angular Router. */
	public readonly childConversationId = input.required<string>();
	/** App router owns all URL and browser-history mutations. */
	private readonly _router = inject(Router);
	/** Exact restoration and target state captured by the parent route. */
	private _history = globalThis.history.state as AgentThreadRouteHistoryState;
	/** Monotonic purge generation already adopted by this coordinator. */
	private _purgeGeneration = 0;
	/** Child Activity projection supplied later by the workspace composition owner. */
	protected readonly activityRows = signal<readonly ConversationActivityRow[]>([]);
	/** Child elicitation projection supplied later by the workspace composition owner. */
	protected readonly elicitation = signal<ConversationElicitation | null>(null);
	/** Child asset projection supplied later by the workspace composition owner. */
	protected readonly asset = signal<ConversationAssetPresentation | null>(null);
	/** Child A2UI projection supplied later by the workspace composition owner. */
	protected readonly a2uiSurface = signal<A2uiSurfacePresentation | null>(null);
	/** Child focus coordinate retained only while this route remains authorized. */
	private readonly _focusTarget = signal<AgentThreadSummaryTarget | null>(this._history.focusTarget ?? null);
	/** Valid exact parent restoration for the current child route. */
	protected readonly parentRestore = computed(this._ParentRestore.bind(this));
	/** Canonical child focus target carried in browser history. */
	protected readonly focusTarget = this._focusTarget.asReadonly();

	/** Return through the exact browser entry created by the parent workspace. */
	protected restoreParent(intent: AgentThreadParentRestoreIntent): void
	{
		if (intent.parentConversationId !== this.parentConversationId()) { void this.openChats(); return; }
		globalThis.history.back();
	}

	/** Navigate to the deliberately non-disclosing chat index. */
	protected async openChats(): Promise<void> { await this._router.navigateByUrl("/chats"); }

	/** Purge every child-owned projection outside the feature store as one operation. */
	protected purgeChildProjection(intent: AgentThreadProjectionPurgeIntent): void
	{
		if (intent.generation <= this._purgeGeneration) return;
		if (intent.parentConversationId !== this.parentConversationId() || intent.childConversationId !== this.childConversationId()) return;
		this._purgeGeneration = intent.generation;
		const purged = _PurgedAgentThreadRouteProjection();
		this.activityRows.set(purged.activityRows);
		this.elicitation.set(purged.elicitation);
		this.asset.set(purged.asset);
		this.a2uiSurface.set(purged.a2uiSurface);
		this._focusTarget.set(purged.focusTarget);
		const retainedHistory = _AgentThreadHistoryAfterPurge(globalThis.history.state);
		globalThis.history.replaceState(retainedHistory, "");
		this._history = retainedHistory;
	}

	/** Accept only restoration state that belongs to this exact parent route. */
	private _ParentRestore(): AgentThreadParentRestoreIntent | null
	{
		const restore = this._history.parentRestore;
		return restore?.parentConversationId === this.parentConversationId() ? restore : null;
	}

}
