import { computed, effect, inject, signal } from "@angular/core";

import type { A2uiSurfacePresentation } from "@opencrane/elements/a2ui";
import { ConversationComposerStates, ConversationStatusTones, type ConversationRunActionsPresentation, type ConversationStatusPresentation } from "@opencrane/elements/conversation";
import { ConversationAssetActionKinds, __ConversationAssetPresentation, __ConversationAssetSelectionFeedback, __PendingConversationAssetPresentation, type ConversationAssetActionIntent, type ConversationAssetPresentation, type ConversationAssetSelectionFeedback } from "@opencrane/features/conversation-assets";
import { ConversationAssetsStore } from "@opencrane/state/conversation/assets";
import { ConversationElicitationStore, __MapToolActivity, type ElicitationResponseValue } from "@opencrane/state/conversation/elicitation";
import { AgUiToolStatuses, ConversationCreationStates, ConversationEventStreamStatuses, ConversationLifecycles, ConversationPersonalAgentStatuses, ConversationRunStates, ConversationWorkspaceRouteStates, ConversationWorkspaceStore } from "@opencrane/state/conversation/workspace";

import { _ConversationMessageViews, _ConversationOnboardingHistoryMessageViews, _ConversationOnboardingHistoryPresentation, _ConversationSummaryPresentation, _LiveMessageViews } from "./conversation-workspace.mapper";
import type { ConversationWorkspaceAvailabilityPresentation } from "./conversation-workspace-feature.types";

/** Feature-scoped presenter that derives view state and delegates typed intents to owning stores. */
export class ConversationWorkspacePresenter
{
	/** Component-scoped conversation orchestration. */
	protected readonly store = inject(ConversationWorkspaceStore);
	/** Existing asset state scoped to the selected conversation. */
	protected readonly assetsStore = inject(ConversationAssetsStore);
	/** Existing typed question and approval state. */
	protected readonly elicitationStore = inject(ConversationElicitationStore);
	/** Whether immutable-mode creation is visible. */
	protected readonly creating = signal(false);
	/** Stable route state vocabulary used by the template switch. */
	protected readonly routeStates = ConversationWorkspaceRouteStates;
	/** Stable conversation lifecycle used by template permissions. */
	protected readonly lifecycles = ConversationLifecycles;
	/** Stable create command lifecycle used by the dialog. */
	protected readonly creationStates = ConversationCreationStates;
	/** Stable tool lifecycle used for truthful recovery copy. */
	protected readonly toolStatuses = AgUiToolStatuses;
	/** Privacy-safe list rows. */
	protected readonly summaries = computed(this._Summaries.bind(this));
	/**
	 * Header copy for the onboarding history, or `null` when the server recorded no completed exchange.
	 *
	 * The template uses the `null` here as its test for whether history can be shown at all, in both the
	 * rail row and the main panel, so this signal doubles as the "is there a transcript" answer.
	 */
	protected readonly onboardingHistoryPresentation = computed(this._OnboardingHistoryPresentation.bind(this));
	/**
	 * The onboarding transcript as rows the shared message elements can render.
	 *
	 * Kept separate from {@link messages} on purpose: these rows never join the live conversation
	 * stream, and the panel that shows them is rendered instead of the transcript, not alongside it.
	 */
	protected readonly onboardingHistoryMessages = computed(this._OnboardingHistoryMessages.bind(this));
	/** Explicit availability state derived from the existing privacy-safe directory. */
	protected readonly availabilityNotice = computed(this._AvailabilityNotice.bind(this));
	/** Privacy-safe row corresponding to the selected authorized snapshot. */
	protected readonly selectedSummary = computed(() => this.summaries().find(summary => summary.id === this.store.selected()?.id) ?? null);
	/** Canonical and live transcript rows mapped through the shared sanitizer. */
	protected readonly messages = computed(this._Messages.bind(this));
	/** Existing asset presentations for transcript and Files views. */
	protected readonly assets = computed(this._Assets.bind(this));
	/** Existing upload feedback presentation. */
	protected readonly assetFeedback = computed(this._AssetFeedback.bind(this));
	/** Tool-failure Activity rows retaining failures even while retrying. */
	protected readonly activityRows = computed(this._ActivityRows.bind(this));
	/** Ordered live tool projections. */
	protected readonly tools = computed(() => Object.values(this.store.live().tools));
	/** Display-only A2UI surfaces from the selected live stream. */
	protected readonly a2uiSurfaces = computed(this._A2uiSurfaces.bind(this));
	/** Shared composer state derived from current command and lifecycle. */
	protected readonly composerState = computed(this._ComposerState.bind(this));
	/** Short truthful live status. */
	protected readonly liveStatus = computed(this._LiveStatus.bind(this));
	/** Run action presentation without command authority. */
	protected readonly runActions = computed(this._RunActions.bind(this));
	/** Load once when this route-ready component is constructed. */
	private readonly _loadEffect = effect(this._Load.bind(this));
	/** Open existing asset and elicitation state whenever stream coordinates change. */
	private readonly _selectionEffect = effect(this._OpenComposedState.bind(this));
	/** Last selected coordinate used to purge composed state before changing scope. */
	private _composedConversationId: string | null = null;

	/** Show immutable-mode creation. */
	protected showCreate(): void { this.creating.set(true); }
	/** Hide immutable-mode creation without changing its controlled selection. */
	protected hideCreate(): void { this.creating.set(false); }
	/** Select one conversation from the feature-local rail. */
	protected async open(conversationId: string): Promise<void> { await this.store.open(conversationId); }
	/** Keep ordinary message input controlled by the conversation store. */
	protected updateDraft(value: string): void { this.store.updateDraft(value); }
	/** Submit ordinary participant input with the exact ready assets selected for this message. */
	protected async send(): Promise<void>
	{
		const assetIds = this.assetsStore.messageAssetIds();
		if (await this.store.send(assetIds)) this.assetsStore.clearMessageSelection(assetIds);
	}
	/** Select files through the existing 200 MB per-message asset state. */
	protected async selectFiles(event: Event): Promise<void>
	{
		const target = event.target;
		if (!(target instanceof HTMLInputElement) || target.files === null) return;
		await this.assetsStore.select([...target.files]);
		target.value = "";
	}
	/** Route existing asset intents back to their owning store. */
	protected async assetAction(intent: ConversationAssetActionIntent): Promise<void>
	{
		if (intent.kind === ConversationAssetActionKinds.Retry) await this.assetsStore.retry(intent.assetId);
		if (intent.kind === ConversationAssetActionKinds.Remove) { this.assetsStore.removeLocal(intent.assetId); await this.assetsStore.remove(intent.assetId); }
	}
	/** Keep typed elicitation selection in its existing store. */
	protected selectElicitation(value: ElicitationResponseValue): void { this.elicitationStore.select(value); }
	/** Submit one typed elicitation response through server authority. */
	protected async submitElicitation(): Promise<void> { await this.elicitationStore.submit(); }
	/** Start the initial parallel directory/list read. */
	private _Load(): void { void this.store.load(); }

	/** Open composed stores and load the first current elicitation reference. */
	private _OpenComposedState(): void
	{
		const selected = this.store.selected();
		if (selected === null)
		{
			this._composedConversationId = null;
			this.assetsStore.clear();
			this.elicitationStore.clear();
			return;
		}
		if (this._composedConversationId !== selected.id)
		{
			this.assetsStore.clear();
			this.elicitationStore.clear();
			this._composedConversationId = selected.id;
		}
		this.assetsStore.open(selected.id);
		this.assetsStore.observeInvalidations(selected.id, this.store.live().customEvents);
		const requestId = this.store.live().interrupts[0]?.id;
		if (requestId !== undefined) void this.elicitationStore.load(selected.id, requestId);
	}

	/** Map safe rail rows. */
	private _Summaries()
	{
		const agentName = this.store.directory()?.personalAgent?.displayName ?? null;
		return this.store.conversations().map(summary => _ConversationSummaryPresentation(summary, agentName));
	}

	/**
	 * Builds the history header, checking for a transcript before mapping one.
	 *
	 * The `null` branch is not defensive padding. The store's projection carries a transcript only in the
	 * `Ready` state, and it starts and stays `null` for a user who has not completed onboarding, whose
	 * account was migrated without a recorded exchange, or whose history read failed — so the common case
	 * is that there is nothing here to map.
	 */
	private _OnboardingHistoryPresentation()
	{
		const history = this.store.onboardingHistory().history;
		return history === null ? null : _ConversationOnboardingHistoryPresentation(history);
	}

	/**
	 * Builds the history transcript rows, checking for a transcript before mapping one.
	 *
	 * Returns an empty list rather than `null` so the history panel's `messages` input is always a real
	 * array; the panel is only rendered when {@link onboardingHistoryPresentation} is non-`null`, so an
	 * empty result never reaches the screen as an empty transcript.
	 */
	private _OnboardingHistoryMessages()
	{
		const history = this.store.onboardingHistory().history;
		return history === null ? [] : _ConversationOnboardingHistoryMessageViews(history);
	}

	/** Explain missing workspace or personal-Agent setup without inventing server state. */
	private _AvailabilityNotice(): ConversationWorkspaceAvailabilityPresentation | null
	{
		const directory = this.store.directory();
		if (directory === null) return null;
		if (!directory.participants.some(participant => participant.isSelf)) return { heading: "No workspace available", detail: "This account has no workspace membership, so conversations cannot be created here." };
		if (directory.personalAgentStatus === ConversationPersonalAgentStatuses.Unavailable) return { heading: "No personal Agent assigned", detail: "Direct and group chats remain available. An administrator must finish Agent setup before you can start an Agent session." };
		if (directory.personalAgentStatus === ConversationPersonalAgentStatuses.Ambiguous) return { heading: "Personal Agent setup needs attention", detail: "More than one personal Agent matched this account. Direct and group chats remain available while an administrator repairs the assignment." };
		return null;
	}

	/** Combine snapshot messages with live AG-UI messages without replacing canonical rows. */
	private _Messages()
	{
		const selected = this.store.selected();
		if (selected === null) return [];
		const canonical = _ConversationMessageViews(selected.messages, { directory: this.store.directory(), summary: selected });
		const canonicalIds = new Set(selected.messages.map(message => message.id));
		const live = Object.values(this.store.live().messages).filter(message => !canonicalIds.has(message.id));
		return [...canonical, ..._LiveMessageViews(live)];
	}

	/** Merge durable and browser-private asset transfers without retaining File bytes here. */
	private _Assets(): readonly ConversationAssetPresentation[]
	{
		const durable = this.assetsStore.assets.hasValue() ? this.assetsStore.assets.value().map(__ConversationAssetPresentation) : [];
		return [...durable, ...this.assetsStore.pendingUploads().map(__PendingConversationAssetPresentation)];
	}

	/** Map the existing asset selection failure to plain copy. */
	private _AssetFeedback(): ConversationAssetSelectionFeedback | null
	{
		const failure = this.assetsStore.selectionFailure();
		return failure === null ? null : __ConversationAssetSelectionFeedback(failure);
	}

	/** Derive every visible tool failure, including failures before successful retry. */
	private _ActivityRows()
	{
		const selected = this.store.selected();
		const runId = this.store.live().runId;
		if (selected === null || runId === null) return [];
		return Object.values(this.store.live().tools).flatMap(tool => __MapToolActivity(selected.id, runId, tool));
	}

	/** Map admitted AG-UI envelopes to display-only A2UI presentations. */
	private _A2uiSurfaces(): readonly A2uiSurfacePresentation[]
	{
		return [...this.store.live().surfaces.values()].map(function _Surface(surface): A2uiSurfacePresentation { return surface; });
	}

	/** Derive composer state without mixing run lifecycle into ordinary chats. */
	private _ComposerState(): ConversationComposerStates
	{
		if (this.store.sending()) return ConversationComposerStates.Submitting;
		return this.store.selected()?.lifecycle === ConversationLifecycles.Open ? ConversationComposerStates.Available : ConversationComposerStates.Disabled;
	}

	/** Map stream connection and failure truth to one shared status line. */
	private _LiveStatus(): ConversationStatusPresentation | null
	{
		const status = this.store.streamStatus();
		if (status === ConversationEventStreamStatuses.Connecting) return { label: "Connecting", detail: "Loading live updates.", tone: ConversationStatusTones.Neutral };
		if (status === ConversationEventStreamStatuses.Reconnecting) return { label: "Reconnecting", detail: "Your draft is still here.", tone: ConversationStatusTones.Attention };
		if (status === ConversationEventStreamStatuses.Failed) return { label: "Live updates stopped", detail: "Reopen the conversation to try again.", tone: ConversationStatusTones.Danger };
		return null;
	}

	/** Map server run state to controlled action visibility. */
	private _RunActions(): ConversationRunActionsPresentation | null
	{
		const run = this.store.runs.run();
		if (run === null) return null;
		const canSteer = this.store.runs.canSteer() || run.state === ConversationRunStates.Queued || run.state === ConversationRunStates.Assigned || run.state === ConversationRunStates.Running;
		return { statusLabel: _RunLabel(run.state), canCancel: this.store.runs.canCancel(), canRetry: this.store.runs.canRetry(), canSteer, busy: this.store.runs.busy() };
	}
}

/** Plain participant-facing label for every canonical run lifecycle. */
function _RunLabel(state: ConversationRunStates): string
{
	switch (state)
	{
		case ConversationRunStates.Accepted: return "Run accepted";
		case ConversationRunStates.Queued: return "Run queued";
		case ConversationRunStates.Assigned: return "Run assigned";
		case ConversationRunStates.Running: return "Agent working";
		case ConversationRunStates.WaitingForInput: return "Waiting for your input";
		case ConversationRunStates.RecoveryRequired: return "Action outcome needs review";
		case ConversationRunStates.Cancelling: return "Cancelling run";
		case ConversationRunStates.Completed: return "Run completed";
		case ConversationRunStates.Failed: return "Run failed";
		case ConversationRunStates.Cancelled: return "Run cancelled";
	}
}
