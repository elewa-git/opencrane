import { Injectable, computed, effect, inject, signal } from "@angular/core";

import { ConversationComputerStates } from "@opencrane/contracts";
import { ConversationAssetActionKinds, __ConversationAssetPresentation, __PendingConversationAssetPresentation, type ConversationAssetActionIntent, type ConversationAssetPresentation } from "@opencrane/features/conversation-assets";
import { ConversationActivityReadStates } from "@opencrane/features/conversation-activity";
import { ConversationAssetsStore } from "@opencrane/state/conversation/assets";
import { ConversationElicitationStore, type ElicitationResponseValue } from "@opencrane/state/conversation/elicitation";
import { CONVERSATION_CURRENT_SUBJECT, ConversationGroupChildStore, ConversationComputerReviewStore, ConversationCreationStates, ConversationLifecycles, ConversationModes, ConversationPersonalAgentStatuses, ConversationPersonalRunsStore, ConversationWorkspaceRouteStates, ConversationWorkspaceStore } from "@opencrane/state/conversation/workspace";

import { _GroupRequestSource, _GroupShareSource } from "./conversation-group.mapper";
import { _PersonalRunActivity } from "./conversation-personal-run-activity.mapper";
import { _ConversationRunActions } from "./conversation-run-actions.mapper";

import { _ConversationEntryViews, _ConversationOnboardingContinuationPresentation, _ConversationOnboardingDialogueEntries, _ConversationOnboardingHistoryPresentation, _ConversationRailIdentityPresentation, _ConversationSessionRailItems, _ConversationSummaryPresentation } from "./conversation-workspace.mapper";
import { _ComposerState, _ComputerStatus, _ConnectionStatus } from "./presentation/conversation-workspace-status.mapper";
import { ConversationWorkspaceTranscriptEntryKinds, type ConversationWorkspaceTranscriptEntry } from "./presentation/conversation-workspace-presentation.types";
import type { ConversationOnboardingContinuationPresentation, ConversationWorkspaceAvailabilityPresentation } from "./conversation-workspace-feature.types";

/** Feature-scoped presenter that derives view state and delegates typed intents to owning stores. */
@Injectable()
export class ConversationWorkspacePresenter
{
	/** Component-scoped conversation orchestration. */
	public readonly store = inject(ConversationWorkspaceStore);
	/** Owns company-assistant requests and reviewed human shares for this selection. */
	public readonly groupStore = inject(ConversationGroupChildStore);
	/** Supplies the verified subject solely for presenting own-message actions. */
	private readonly _subject = inject(CONVERSATION_CURRENT_SUBJECT);
	/** Existing asset state scoped to the selected conversation. */
	public readonly assetsStore = inject(ConversationAssetsStore);
	/** Component-scoped active-computer review state. */
	public readonly reviewStore = inject(ConversationComputerReviewStore);
	/** Reads recent personal work independently from the selected transcript. */
	public readonly personalRuns = inject(ConversationPersonalRunsStore);
	/** Existing typed question and approval state for the selected conversation. */
	public readonly elicitationStore = inject(ConversationElicitationStore);
	/** Whether immutable-mode creation is visible. */
	public readonly creating = signal(false);
	/** Stable route state vocabulary used by the template switch. */
	public readonly routeStates = ConversationWorkspaceRouteStates;
	/** Stable conversation lifecycle used by template permissions. */
	public readonly lifecycles = ConversationLifecycles;
	/** Stable immutable modes used by capability-aware presentation. */
	public readonly modes = ConversationModes;
	/** Stable lifecycle required before active review controls are shown. */
	public readonly computerStates = ConversationComputerStates;
	/** Stable create command lifecycle used by the dialog. */
	public readonly creationStates = ConversationCreationStates;
	/** Privacy-safe list rows. */
	public readonly summaries = computed(this._Summaries.bind(this));
	/** Completed onboarding and ordinary conversations in one visual My sessions list. */
	public readonly sessionRailItems = computed(this._SessionRailItems.bind(this));
	/** Selected browser key for the visually unified session rail. */
	public readonly selectedSessionKey = computed(this._SelectedSessionKey.bind(this));
	/** Browser-safe self label shown at the bottom of the rail when the directory exposes one. */
	public readonly railIdentity = computed(this._RailIdentity.bind(this));
	/**
	 * Header copy for the onboarding history, or `null` when the server recorded no completed exchange.
	 *
	 * The template uses the `null` here as its test for whether history can be shown at all, in both the
	 * rail row and the main panel, so this signal doubles as the "is there a transcript" answer.
	 */
	public readonly onboardingHistoryPresentation = computed(this._OnboardingHistoryPresentation.bind(this));
	/** Dedicated onboarding dialogue that never joins the live conversation message stream. */
	public readonly onboardingDialogue = computed(this._OnboardingDialogue.bind(this));
	/** Explicit availability state derived from the existing privacy-safe directory. */
	public readonly availabilityNotice = computed(this._AvailabilityNotice.bind(this));
	/** Read-only tray copy derived from the same directory used by conversation creation. */
	public readonly onboardingContinuation = computed(this._OnboardingContinuation.bind(this));
	/** Privacy-safe row corresponding to the selected authorized snapshot. */
	public readonly selectedSummary = computed(() => this.summaries().find(summary => summary.id === this.store.selected()?.id) ?? null);
	/** Canonical and live transcript rows mapped through the shared sanitizer. */
	public readonly messages = computed(this._Messages.bind(this));
	/** Links recent work only to answers currently rendered in this selection. */
	public readonly activityRows = computed(() => _PersonalRunActivity(this.personalRuns.runs(), this.store.selected()?.id ?? null, this.store.live().entries, new Set(this.messages().flatMap(entry => entry.kind === ConversationWorkspaceTranscriptEntryKinds.Message ? [entry.message.id] : []))));
	/** Presents read progress separately from the server's run lifecycle. */
	public readonly activityReadState = computed(this._ActivityReadState.bind(this));
	/** Current personal work state and Stop availability for the shared action row. */
	public readonly runActions = computed(() => _ConversationRunActions(this.personalRuns.currentRun(), this.personalRuns.stopPending(), this.personalRuns.stopBusy(), this.personalRuns.stopError()));
	/** Existing asset presentations for transcript and Files views. */
	public readonly assets = computed(this._Assets.bind(this));
	/** Participant-facing name for the selected context panel. */
	public readonly contextPanelLabel = computed(this._ContextPanelLabel.bind(this));
	/** Shared composer state derived from current command and lifecycle. */
	public readonly composerState = computed(() => _ComposerState(this.store.sending(), this.store.streamStatus(), this.store.selected()?.lifecycle));
	/** In-composer connection notice derived from the selected stream phase. */
	public readonly connectionStatus = computed(() => _ConnectionStatus(this.store.streamStatus(), this.store.reconnectAttempt()));
	/** Current logical computer status rendered without exposing its lease or sandbox coordinates. */
	public readonly computerStatus = computed(() => _ComputerStatus(this.store.live().computer?.state));
	/** Whether the selected conversation currently has a reviewable warm computer. */
	public readonly computerReviewVisible = computed(this._ComputerReviewVisible.bind(this));
	/** Closes the local creation dialog when loading or access loss replaces the ready workspace. */
	private readonly _creationAvailabilityEffect = effect(this._CloseUnavailableCreation.bind(this));

	/** Show immutable-mode creation. */
	public showCreate(): void { this.creating.set(true); }
	/** Hide immutable-mode creation without changing its controlled selection. */
	public hideCreate(): void { this.creating.set(false); }
	/** Select one conversation from the feature-local rail. */
	public async open(conversationId: string): Promise<void> { await this.store.open(conversationId); }
	/** Opens the explicit company assistant picker for an eligible own message. */
	public askAssistant(messageId: string): void
	{
		const entry = this.messages().find(candidate => candidate.id === messageId);
		const source = entry?.kind === ConversationWorkspaceTranscriptEntryKinds.Message ? entry.requestSource : null;
		if (source != null)
			this.groupStore.ask(source);
	}
	/** Opens editable text review for a completed assistant response in the selected child. */
	public reviewGroupShare(messageId: string): void
	{
		const entry = this.messages().find(candidate => candidate.id === messageId);
		const source = entry?.kind === ConversationWorkspaceTranscriptEntryKinds.Message ? entry.shareSource : null;
		if (source != null)
			this.groupStore.reviewShare(source);
	}
	/** Keep ordinary message input controlled by the conversation store. */
	public updateDraft(value: string): void { this.store.updateDraft(value); }
	/** Submit ordinary participant text through the authenticated history command. */
	public async send(): Promise<void> { await this.store.send(); }
	/** Ask the selected workspace store to replace a paused or failed socket. */
	public reconnect(): void { this.store.reconnect(); }
	/** Ask the personal work store to append one retry-stable Stop control message. */
	public async stopCurrentWork(): Promise<void> { await this.personalRuns.requestStop(); }
	/** Keep the selected approval response in its component-scoped state owner. */
	public selectElicitation(value: ElicitationResponseValue): void { this.elicitationStore.select(value); }
	/** Submit the selected response through the existing authority-backed store. */
	public async submitElicitation(): Promise<void> { await this.elicitationStore.submit(); }
	/** Reconcile the exact request after verified sign-in completes. */
	public async recoverElicitationAfterStepUp(): Promise<void> { await this.elicitationStore.recoverAfterStepUp(); }
	/** Route existing asset intents back to their owning store. */
	public async assetAction(intent: ConversationAssetActionIntent): Promise<void>
	{
		if (intent.kind === ConversationAssetActionKinds.Retry)
			await this.assetsStore.retry(intent.assetId);
		if (intent.kind === ConversationAssetActionKinds.Remove)
			{ this.assetsStore.removeLocal(intent.assetId); await this.assetsStore.remove(intent.assetId); }
	}

	/** Prevent a dismissed workspace dialog from reopening after authority is rechecked. */
	private _CloseUnavailableCreation(): void
	{
		if (this.store.routeState() !== ConversationWorkspaceRouteStates.Ready)
			this.creating.set(false);
	}

	/** Map safe rail rows. */
	private _Summaries()
	{
		const directory = this.store.directory();
		return this.store.conversations().map(summary => _ConversationSummaryPresentation(summary, directory));
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
	private _Messages(): ConversationWorkspaceTranscriptEntry[]
	{
		const selected = this.store.selected();
		if (selected === null)
			return [];
		const history = this.store.live();
		const entries = new Map(history.entries.map(entry => [entry.id, entry]));
		const subject = this._subject() ?? undefined;
		const children = this.groupStore.children();
		return _ConversationEntryViews(history.entries, history.payloads).map(function _GroupActions(view)
		{
			if (view.kind === ConversationWorkspaceTranscriptEntryKinds.ToolActivity)
				return view;
			const entry = entries.get(view.id)!;
			return { ...view, requestSource: _GroupRequestSource(entry, history.payloads, selected, subject), shareSource: _GroupShareSource(entry, history.payloads, selected), children: children.filter(child => child.parentMessageId === entry.id) };
		});
	}

	/** Merge durable and browser-private asset transfers without retaining File bytes here. */
	private _Assets(): readonly ConversationAssetPresentation[]
	{
		const durable = this.assetsStore.assets.hasValue() ? this.assetsStore.assets.value().map(__ConversationAssetPresentation) : [];
		return [...durable, ...this.assetsStore.pendingUploads().map(__PendingConversationAssetPresentation)];
	}

	/** Name the context panel after the capabilities its selected mode can expose. */
	private _ContextPanelLabel(): string { return this.personalRuns.eligible() ? "Activity and files" : "Files"; }

	/** Marks rows as refreshing until the current permission-checked read completes. */
	private _ActivityReadState(): ConversationActivityReadStates
	{
		if (this.personalRuns.loading())
			return this.activityRows().length > 0 ? ConversationActivityReadStates.Refreshing : ConversationActivityReadStates.Loading;
		return this.personalRuns.error() === null ? ConversationActivityReadStates.Ready : ConversationActivityReadStates.Error;
	}


	/** Admit the review visual only for a warm Agent-session computer. */
	private _ComputerReviewVisible(): boolean
	{
		return this.store.selected()?.mode === ConversationModes.AgentSession && this.store.live().computer?.state === ConversationComputerStates.Warm;
	}
}
