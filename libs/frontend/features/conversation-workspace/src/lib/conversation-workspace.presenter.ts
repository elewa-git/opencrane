import { computed, effect, inject, signal } from "@angular/core";

import { ConversationComputerStates } from "@opencrane/contracts";
import { ConversationComposerStates, ConversationStatusTones, type ConversationStatusPresentation } from "@opencrane/elements/conversation";
import { ConversationAssetActionKinds, __ConversationAssetPresentation, __PendingConversationAssetPresentation, type ConversationAssetActionIntent, type ConversationAssetPresentation } from "@opencrane/features/conversation-assets";
import { ConversationAssetsStore } from "@opencrane/state/conversation/assets";
import { ConversationComputerReviewStore, ConversationCreationStates, ConversationEventStreamStatuses, ConversationLifecycles, ConversationModes, ConversationPersonalAgentStatuses, ConversationWorkspaceRouteStates, ConversationWorkspaceStore } from "@opencrane/state/conversation/workspace";

import { _ConversationEntryViews, _ConversationOnboardingContinuationPresentation, _ConversationOnboardingDialogueEntries, _ConversationOnboardingHistoryPresentation, _ConversationRailIdentityPresentation, _ConversationSessionRailItems, _ConversationSummaryPresentation } from "./conversation-workspace.mapper";
import type { ConversationOnboardingContinuationPresentation, ConversationWorkspaceAvailabilityPresentation } from "./conversation-workspace-feature.types";

/** Display-safe connection notice and whether it offers a participant-requested replacement socket. */
interface ConversationWorkspaceConnectionPresentation
{
	/** Shared status-line copy and tone for the current stream phase. */
	readonly status: ConversationStatusPresentation;
	/** Whether the current stream phase allows a participant to reconnect immediately. */
	readonly reconnectAvailable: boolean;
}

/** Feature-scoped presenter that derives view state and delegates typed intents to owning stores. */
export class ConversationWorkspacePresenter
{
	/** Component-scoped conversation orchestration. */
	protected readonly store = inject(ConversationWorkspaceStore);
	/** Existing asset state scoped to the selected conversation. */
	protected readonly assetsStore = inject(ConversationAssetsStore);
	/** Component-scoped active-computer review state. */
	protected readonly reviewStore = inject(ConversationComputerReviewStore);
	/** Whether immutable-mode creation is visible. */
	protected readonly creating = signal(false);
	/** Stable route state vocabulary used by the template switch. */
	protected readonly routeStates = ConversationWorkspaceRouteStates;
	/** Stable conversation lifecycle used by template permissions. */
	protected readonly lifecycles = ConversationLifecycles;
	/** Stable immutable modes used by capability-aware presentation. */
	protected readonly modes = ConversationModes;
	/** Stable lifecycle required before active review controls are shown. */
	protected readonly computerStates = ConversationComputerStates;
	/** Stable create command lifecycle used by the dialog. */
	protected readonly creationStates = ConversationCreationStates;
	/** Privacy-safe list rows. */
	protected readonly summaries = computed(this._Summaries.bind(this));
	/** Completed onboarding and ordinary conversations in one visual My sessions list. */
	protected readonly sessionRailItems = computed(this._SessionRailItems.bind(this));
	/** Selected browser key for the visually unified session rail. */
	protected readonly selectedSessionKey = computed(this._SelectedSessionKey.bind(this));
	/** Browser-safe self label shown at the bottom of the rail when the directory exposes one. */
	protected readonly railIdentity = computed(this._RailIdentity.bind(this));
	/**
	 * Header copy for the onboarding history, or `null` when the server recorded no completed exchange.
	 *
	 * The template uses the `null` here as its test for whether history can be shown at all, in both the
	 * rail row and the main panel, so this signal doubles as the "is there a transcript" answer.
	 */
	protected readonly onboardingHistoryPresentation = computed(this._OnboardingHistoryPresentation.bind(this));
	/** Dedicated onboarding dialogue that never joins the live conversation message stream. */
	protected readonly onboardingDialogue = computed(this._OnboardingDialogue.bind(this));
	/** Explicit availability state derived from the existing privacy-safe directory. */
	protected readonly availabilityNotice = computed(this._AvailabilityNotice.bind(this));
	/** Read-only tray copy derived from the same directory used by conversation creation. */
	protected readonly onboardingContinuation = computed(this._OnboardingContinuation.bind(this));
	/** Privacy-safe row corresponding to the selected authorized snapshot. */
	protected readonly selectedSummary = computed(() => this.summaries().find(summary => summary.id === this.store.selected()?.id) ?? null);
	/** Canonical and live transcript rows mapped through the shared sanitizer. */
	protected readonly messages = computed(this._Messages.bind(this));
	/** Existing asset presentations for transcript and Files views. */
	protected readonly assets = computed(this._Assets.bind(this));
	/** Participant-facing name for the selected context panel. */
	protected readonly contextPanelLabel = computed(this._ContextPanelLabel.bind(this));
	/** Shared composer state derived from current command and lifecycle. */
	protected readonly composerState = computed(this._ComposerState.bind(this));
	/** In-composer connection notice derived from the selected stream phase. */
	protected readonly connectionStatus = computed(this._ConnectionStatus.bind(this));
	/** Current logical computer status rendered without exposing its lease or sandbox coordinates. */
	protected readonly computerStatus = computed(this._ComputerStatus.bind(this));
	/** Whether the selected conversation currently has a reviewable warm computer. */
	protected readonly computerReviewVisible = computed(this._ComputerReviewVisible.bind(this));
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
	/** Submit ordinary participant text through the authenticated history command. */
	protected async send(): Promise<void> { await this.store.send(); }
	/** Ask the selected workspace store to replace a paused or failed socket. */
	protected reconnect(): void { this.store.reconnect(); }
	/** Route existing asset intents back to their owning store. */
	protected async assetAction(intent: ConversationAssetActionIntent): Promise<void>
	{
		if (intent.kind === ConversationAssetActionKinds.Retry)
			await this.assetsStore.retry(intent.assetId);
		if (intent.kind === ConversationAssetActionKinds.Remove)
			{ this.assetsStore.removeLocal(intent.assetId); await this.assetsStore.remove(intent.assetId); }
	}
	/** Start the initial parallel directory/list read. */
	private _Load(): void { void this.store.load(); }

	/** Open the asset state whenever the selected conversation changes. */
	private _OpenComposedState(): void
	{
		const selected = this.store.selected();
		if (selected === null)
		{
			this._composedConversationId = null;
			this.assetsStore.clear();
			this.reviewStore.select(null);
			return;
		}
		if (this._composedConversationId !== selected.id)
		{
			this.assetsStore.clear();
			this._composedConversationId = selected.id;
		}
		this.assetsStore.open(selected.id);
		const computer = this.store.live().computer;
		const reviewConversationId = selected.mode === ConversationModes.AgentSession && computer?.state === ConversationComputerStates.Warm ? selected.id : null;
		const generationKey = computer === null ? null : `${computer.id}:${computer.leaseGeneration}`;
		this.reviewStore.select(reviewConversationId, generationKey);
	}

	/** Map safe rail rows. */
	private _Summaries()
	{
		const agentName = this.store.directory()?.personalAgent?.displayName ?? null;
		return this.store.conversations().map(summary => _ConversationSummaryPresentation(summary, agentName));
	}

	/** Build one visual rail without turning onboarding into a fake Conversation. */
	private _SessionRailItems()
	{
		return _ConversationSessionRailItems(this.summaries(), this.onboardingHistoryPresentation());
	}

	/** Select the visual key corresponding to the current internal projection. */
	private _SelectedSessionKey(): string | null
	{
		const history = this.onboardingHistoryPresentation();
		if (this.store.onboardingHistorySelected() && history !== null)
			return `onboarding:${history.id}`;
		return this.store.selected()?.id ?? null;
	}

	/** Map only the directory's existing browser-safe self label. */
	private _RailIdentity()
	{
		return _ConversationRailIdentityPresentation(this.store.directory());
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
	 * Builds the dedicated onboarding dialogue, checking for a transcript before mapping one.
	 *
	 * Returns an empty list rather than `null` so the panel's `entries` input is always a real
	 * array; the panel is only rendered when {@link onboardingHistoryPresentation} is non-`null`, so an
	 * empty result never reaches the screen as an empty transcript.
	 */
	private _OnboardingDialogue()
	{
		const history = this.store.onboardingHistory().history;
		return history === null ? [] : _ConversationOnboardingDialogueEntries(history);
	}

	/** Explain the read-only boundary and the currently available next conversation modes. */
	private _OnboardingContinuation(): ConversationOnboardingContinuationPresentation
	{
		return _ConversationOnboardingContinuationPresentation(this.store.directory());
	}

	/** Explain missing workspace or personal-Agent setup without inventing server state. */
	private _AvailabilityNotice(): ConversationWorkspaceAvailabilityPresentation | null
	{
		const directory = this.store.directory();
		if (directory === null)
			return null;
		if (!directory.participants.some(participant => participant.isSelf))
			return { heading: "No workspace available", detail: "This account has no workspace membership, so conversations cannot be created here." };
		if (directory.personalAgentStatus === ConversationPersonalAgentStatuses.Unavailable)
			return { heading: "No personal Agent assigned", detail: "Direct and group chats remain available. An administrator must finish Agent setup before you can start an Agent session." };
		if (directory.personalAgentStatus === ConversationPersonalAgentStatuses.Ambiguous)
			return { heading: "Personal Agent setup needs attention", detail: "More than one personal Agent matched this account. Direct and group chats remain available while an administrator repairs the assignment." };
		return null;
	}

	/** Map immutable Kurrent history using only server-resolved private text payloads. */
	private _Messages()
	{
		const selected = this.store.selected();
		if (selected === null)
			return [];
		return _ConversationEntryViews(this.store.live().entries, this.store.live().payloads);
	}

	/** Merge durable and browser-private asset transfers without retaining File bytes here. */
	private _Assets(): readonly ConversationAssetPresentation[]
	{
		const durable = this.assetsStore.assets.hasValue() ? this.assetsStore.assets.value().map(__ConversationAssetPresentation) : [];
		return [...durable, ...this.assetsStore.pendingUploads().map(__PendingConversationAssetPresentation)];
	}

	/** Name the context panel after the capabilities its selected mode can expose. */
	private _ContextPanelLabel(): string { return "Files"; }

	/** Derive composer state without mixing run lifecycle into ordinary chats. */
	private _ComposerState(): ConversationComposerStates
	{
		if (this.store.sending())
			return ConversationComposerStates.Submitting;
		if (this.store.streamStatus() !== ConversationEventStreamStatuses.Live)
			return ConversationComposerStates.Disabled;
		return this.store.selected()?.lifecycle === ConversationLifecycles.Open ? ConversationComposerStates.Available : ConversationComposerStates.Disabled;
	}

	/** Map stream connection and failure truth to the in-composer recovery bar. */
	private _ConnectionStatus(): ConversationWorkspaceConnectionPresentation | null
	{
		const status = this.store.streamStatus();
		if (status === ConversationEventStreamStatuses.Connecting)
			return { status: { label: "Connecting to chat", detail: "Messages will be available when the connection is ready.", tone: ConversationStatusTones.Neutral }, reconnectAvailable: false };
		if (status === ConversationEventStreamStatuses.Reconnecting)
			return { status: { label: `Reconnecting — attempt ${this.store.reconnectAttempt()}`, detail: "Your draft is still here. Sending resumes when the connection returns.", tone: ConversationStatusTones.Attention }, reconnectAvailable: true };
		if (status === ConversationEventStreamStatuses.Failed)
			return { status: { label: "Connection lost", detail: "Automatic reconnecting stopped. Your draft is still here.", tone: ConversationStatusTones.Danger, assertive: true }, reconnectAvailable: true };
		return null;
	}

	/** Map the current logical computer lifecycle to concise participant-facing copy. */
	private _ComputerStatus(): ConversationStatusPresentation | null
	{
		const state = this.store.live().computer?.state;
		if (state === undefined)
			return null;
		return { label: _ComputerLabel(state), detail: "Your conversation history remains available while the computer changes state.", tone: state === ConversationComputerStates.RecoveryRequired ? ConversationStatusTones.Danger : ConversationStatusTones.Neutral };
	}

	/** Admit the review visual only for a warm Agent-session computer. */
	private _ComputerReviewVisible(): boolean
	{
		return this.store.selected()?.mode === ConversationModes.AgentSession && this.store.live().computer?.state === ConversationComputerStates.Warm;
	}
}

/** Plain participant-facing label for every logical computer lifecycle. */
function _ComputerLabel(state: ConversationComputerStates): string
{
	switch (state)
	{
		case ConversationComputerStates.Cold: return "Computer is asleep";
		case ConversationComputerStates.ClaimPending: return "Computer is waking";
		case ConversationComputerStates.Warm: return "Computer is ready";
		case ConversationComputerStates.Cooling: return "Computer is saving work";
		case ConversationComputerStates.RecoveryRequired: return "Computer needs attention";
		case ConversationComputerStates.Retired: return "Computer is retired";
	}
}
