import { DOCUMENT } from "@angular/common";
import { ChangeDetectionStrategy, Component, afterRenderEffect, computed, effect, inject, input, output } from "@angular/core";
import type { MenuItem } from "primeng/api";
import { BreadcrumbModule } from "primeng/breadcrumb";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";

import { A2uiCanvasComponent, type A2uiDisplayedActionIntent, type A2uiSurfacePresentation } from "@opencrane/elements/a2ui";
import { ConversationComposerComponent, ConversationComposerStates, ConversationMessageComponent } from "@opencrane/elements/conversation";
import { ConversationActivityComponent } from "@opencrane/features/conversation-activity";
import { ConversationAssetCardComponent, type ConversationAssetActionIntent, type ConversationAssetPresentation } from "@opencrane/features/conversation-assets";
import { ConversationElicitationCardComponent } from "@opencrane/features/conversation-elicitation";
import { AgentThreadRecoveryStates, AgentThreadRouteStates, AgentThreadRunStates, AgentThreadStore, AgentThreadTimelineEntryKinds, type AgentThreadParentRestoreIntent, type AgentThreadSummaryTarget } from "@opencrane/state/conversation/agent-threads";
import type { ConversationActivityRow, ConversationActivityTarget, ConversationElicitation, ElicitationResponseValue } from "@opencrane/state/conversation/elicitation";

import { AgentThreadAccessChangedComponent } from "./agent-thread-access-changed.component.js";
import { AgentThreadAvailableComponent } from "./agent-thread-available.component.js";
import { AgentThreadDeliveryComponent } from "./agent-thread-delivery.component.js";
import type { AgentThreadProjectionPurgeIntent } from "./agent-thread-feature.types.js";
import { __AgentThreadMessagePresentation } from "./agent-thread.mapper.js";
import { AgentThreadOriginComponent } from "./agent-thread-origin.component.js";
import { AgentThreadQueuedComponent } from "./agent-thread-queued.component.js";
import { AgentThreadRunBoundaryComponent } from "./agent-thread-run-boundary.component.js";
import { AgentThreadUnavailableComponent } from "./agent-thread-unavailable.component.js";

/** Thin route-ready child workspace; the app route coordinator still owns navigation and restoration. */
@Component({ selector: "wo-agent-thread-page", standalone: true, imports: [A2uiCanvasComponent, AgentThreadAccessChangedComponent, AgentThreadAvailableComponent, AgentThreadDeliveryComponent, AgentThreadOriginComponent, AgentThreadQueuedComponent, AgentThreadRunBoundaryComponent, AgentThreadUnavailableComponent, BreadcrumbModule, ButtonModule, ConversationActivityComponent, ConversationAssetCardComponent, ConversationComposerComponent, ConversationElicitationCardComponent, ConversationMessageComponent, MessageModule], templateUrl: "./agent-thread-page.component.html", styleUrl: "./agent-thread-page.component.scss", changeDetection: ChangeDetectionStrategy.OnPush, providers: [AgentThreadStore] })
export class AgentThreadPageComponent
{
	/** Component-scoped route and command state. */
	protected readonly store = inject(AgentThreadStore);
	/** Browser document used only after Angular has rendered an authorized target. */
	private readonly _document = inject(DOCUMENT);
	/** Parent group conversation route coordinate. */
	public readonly parentConversationId = input.required<string>();
	/** Child Agent-session conversation route coordinate. */
	public readonly childConversationId = input.required<string>();
	/** Optional exact parent restoration coordinate captured before navigation. */
	public readonly parentRestore = input<AgentThreadParentRestoreIntent | null>(null);
	/** Optional canonical focus target carried by the child route. */
	public readonly focusTarget = input<AgentThreadSummaryTarget | null>(null);
	/** Existing Activity rows supplied by the workspace composition owner. */
	public readonly activityRows = input<readonly ConversationActivityRow[]>([]);
	/** Existing recoverable question or approval projection. */
	public readonly elicitation = input<ConversationElicitation | null>(null);
	/** Existing controlled elicitation draft. */
	public readonly elicitationDraft = input<ElicitationResponseValue | null>(null);
	/** Whether the existing elicitation command is active. */
	public readonly elicitationBusy = input(false);
	/** Display-safe existing elicitation error. */
	public readonly elicitationError = input<string | null>(null);
	/** Existing participant or generated asset presentation. */
	public readonly asset = input<ConversationAssetPresentation | null>(null);
	/** Existing admitted A2UI surface. */
	public readonly a2uiSurface = input<A2uiSurfacePresentation | null>(null);
	/** Requests exact parent focus and scroll restoration. */
	public readonly parentRestoreRequested = output<AgentThreadParentRestoreIntent>();
	/** Requests a safe return to the chat index when no parent restoration is available. */
	public readonly chatsRequested = output<void>();
	/** Requests one atomic purge of all child-owned projections composed outside this package. */
	public readonly childProjectionPurgeRequested = output<AgentThreadProjectionPurgeIntent>();
	/** Forwards the existing Activity component's canonical target. */
	public readonly activityTargetRequested = output<ConversationActivityTarget>();
	/** Forwards the existing elicitation component's controlled draft. */
	public readonly elicitationDraftSelected = output<ElicitationResponseValue>();
	/** Forwards a submit intent to the existing elicitation store owner. */
	public readonly elicitationSubmitRequested = output<void>();
	/** Forwards an existing asset action intent to the workspace owner. */
	public readonly assetActionRequested = output<ConversationAssetActionIntent>();
	/** Forwards a displayed A2UI action intent to the authoritative host. */
	public readonly a2uiActionRequested = output<A2uiDisplayedActionIntent>();
	/** Stable route state vocabulary used by the explicit template switch. */
	protected readonly routeStates = AgentThreadRouteStates;
	/** Stable recovery vocabulary used independently from route state. */
	protected readonly recoveryStates = AgentThreadRecoveryStates;
	/** Stable run vocabulary used for the queued state. */
	protected readonly runStates = AgentThreadRunStates;
	/** Stable ordered timeline vocabulary used by the template. */
	protected readonly entryKinds = AgentThreadTimelineEntryKinds;
	/** Breadcrumbs derived only from authorized snapshot labels. */
	protected readonly breadcrumbs = computed(this._Breadcrumbs.bind(this));
	/** Controlled composer state derived from independent store dimensions. */
	protected readonly composerState = computed(this._ComposerState.bind(this));

	/** Load whenever the route coordinator supplies a different exact pair of ids. */
	private readonly _routeLoader = effect(this._LoadRoute.bind(this));
	/** Notify the route coordinator whenever this store purges its owned child projection. */
	private readonly _purgeNotifier = effect(this._NotifyProjectionPurge.bind(this));
	/** Mark and focus only content Angular has finished rendering into the document. */
	private readonly _visibleProjection = afterRenderEffect(this._AfterAuthorizedRender.bind(this));
	/** Last purge generation already emitted to the route coordinator. */
	private _emittedPurgeGeneration = 0;
	/** Last exact target already focused for the current authorized snapshot. */
	private _focusedTargetKey: string | null = null;

	/** Forward exact parent restoration, or fall back to the non-disclosing chat index. */
	protected returnToParent(): void
	{
		const restore = this.parentRestore();
		const snapshot = this.store.snapshot();
		const authorizedSnapshotMatches = restore !== null && snapshot !== null && restore.parentConversationId === snapshot.parentConversationId && restore.parentMessageId === snapshot.origin.parentMessageId;
		const purgedAccessChangeMatches = restore !== null && this.store.routeState() === AgentThreadRouteStates.AccessChanged && restore.parentConversationId === this.parentConversationId();
		const exact = authorizedSnapshotMatches || purgedAccessChangeMatches;
		if (!exact) this.chatsRequested.emit();
		else this.parentRestoreRequested.emit(restore);
	}

	/** Forward a controlled follow-up draft into component-scoped state. */
	protected updateDraft(draft: string): void { this.store.updateDraft(draft); }

	/** Submit through the component-scoped store; the store owns idempotency and adoption. */
	protected async submitFollowUp(): Promise<void> { await this.store.sendFollowUp(); }

	/** Map one dependency-neutral message into the shared presentation element. */
	protected messagePresentation(entry: Parameters<typeof __AgentThreadMessagePresentation>[0]) { return __AgentThreadMessagePresentation(entry); }

	/** Whether the latest serial run is durably queued. */
	protected latestRunIsQueued(): boolean
	{
		const timeline = this.store.snapshot()?.timeline ?? [];
		const runs = timeline.filter(entry => entry.kind === AgentThreadTimelineEntryKinds.RunBoundary);
		return runs.length > 0 && runs[runs.length - 1]?.run.state === AgentThreadRunStates.Queued;
	}

	/** Build authorized breadcrumbs without guessing a child title before a snapshot exists. */
	private _Breadcrumbs(): MenuItem[]
	{
		const snapshot = this.store.snapshot();
		if (snapshot === null) return [{ label: "Chats", command: this._RequestChats.bind(this) }, { label: "Agent thread" }];
		return [{ label: "Chats", command: this._RequestChats.bind(this) }, { label: snapshot.origin.parentTitle, command: this.returnToParent.bind(this) }, { label: snapshot.summary.title }];
	}

	/** Keep the shared composer controlled by the store's independent state dimensions. */
	private _ComposerState(): ConversationComposerStates
	{
		if (this.store.submitting()) return ConversationComposerStates.Submitting;
		return this.store.canSendFollowUp() ? ConversationComposerStates.Available : ConversationComposerStates.Disabled;
	}

	/** Read the exact route pair; the route coordinator remains responsible for URL ownership. */
	private _LoadRoute(): void { void this.store.load(this.parentConversationId(), this.childConversationId()); }

	/** Emit a chat-index route intent from the first breadcrumb. */
	private _RequestChats(): void { this.chatsRequested.emit(); }

	/** Forward each store purge exactly once with the exact route being discarded. */
	private _NotifyProjectionPurge(): void
	{
		const generation = this.store.projectionPurgeGeneration();
		if (generation === 0 || generation === this._emittedPurgeGeneration) return;
		this._emittedPurgeGeneration = generation;
		this._focusedTargetKey = null;
		this.childProjectionPurgeRequested.emit({ generation, parentConversationId: this.parentConversationId(), childConversationId: this.childConversationId() });
	}

	/** Persist the rendered position and focus the canonical target after authorized DOM paint. */
	private _AfterAuthorizedRender(): void
	{
		const snapshot = this.store.snapshot();
		if (this.store.routeState() !== AgentThreadRouteStates.Ready || snapshot === null) return;
		void this.store.markVisible();
		const target = this.focusTarget() ?? snapshot.summary.target;
		const targetKey = `${snapshot.childConversationId}\u0000${target.kind}\u0000${target.id}`;
		if (targetKey === this._focusedTargetKey) return;
		const element = this._document.getElementById(target.id);
		if (element === null) return;
		element.focus({ preventScroll: true });
		element.scrollIntoView({ block: "center", behavior: "auto" });
		this._focusedTargetKey = targetKey;
	}
}
