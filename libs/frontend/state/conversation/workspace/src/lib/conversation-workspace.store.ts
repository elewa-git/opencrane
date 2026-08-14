import { DestroyRef, Injectable, computed, inject, signal } from "@angular/core";

import { ConversationLifecycles, ConversationModes, MessageContentBlockKinds } from "@opencrane/models/conversations";
import { __CreateAgUiStreamState, type AgUiStreamState } from "@opencrane/state/conversation/ag-ui";
import { ConversationEventStreamStatuses, type ConversationEventStreamUpdate } from "@opencrane/state/conversation/stream";

import { ConversationWorkspaceGatewayError, ConversationWorkspaceGatewayErrorKinds } from "./conversation-workspace-gateway.errors";
import { CONVERSATION_WORKSPACE_EVENT_STREAM, CONVERSATION_WORKSPACE_GATEWAY } from "./conversation-workspace.gateway";
import { ConversationOnboardingHistoryStore } from "./conversation-onboarding-history.store";
import { ConversationRunStore } from "./conversation-run.store";
import { ConversationCreationStates, ConversationOnboardingHistoryStatuses, ConversationPersonalAgentStatuses, ConversationWorkspaceRouteStates, type ConversationCreationDirectory, type ConversationSummary, type ConversationWorkspaceDetail, type ConversationWorkspaceNavigationIntent, type CreateConversationCommand, type SubmitConversationMessageBlock, type SubmitConversationMessageCommand } from "./conversation-workspace.types";

/** Component-scoped owner for workspace reads, live tailing, drafts, and commands. */
@Injectable()
export class ConversationWorkspaceStore
{
	/** Participant-scoped generated-client port. */
	private readonly _gateway = inject(CONVERSATION_WORKSPACE_GATEWAY);
	/** Shared conversation projection stream port. */
	private readonly _stream = inject(CONVERSATION_WORKSPACE_EVENT_STREAM);
	/** Component lifetime used to stop the selected conversation stream. */
	private readonly _destroyRef = inject(DestroyRef);
	/** Route-level load state. */
	private readonly _routeState = signal(ConversationWorkspaceRouteStates.Loading);
	/** Privacy-safe creation choices. */
	private readonly _directory = signal<ConversationCreationDirectory | null>(null);
	/** Current non-archived conversation list. */
	private readonly _conversations = signal<readonly ConversationSummary[]>([]);
	/** Selected canonical snapshot. */
	private readonly _selected = signal<ConversationWorkspaceDetail | null>(null);
	/** Live projected state after the bounded snapshot. */
	private readonly _live = signal<AgUiStreamState>(__CreateAgUiStreamState());
	/** Current stream connection phase. */
	private readonly _streamStatus = signal<ConversationEventStreamStatuses | null>(null);
	/** Controlled message draft. */
	private readonly _draft = signal("");
	/** Immutable mode selected for the next create command. */
	private readonly _creationMode = signal<ConversationModes>(ConversationModes.AgentSession);
	/** Opaque human coordinates selected for the next create command. */
	private readonly _selectedParticipantRefs = signal<ReadonlySet<string>>(new Set());
	/** Create command lifecycle. */
	private readonly _creationState = signal(ConversationCreationStates.Idle);
	/** Whether a message command is active. */
	private readonly _sending = signal(false);
	/** Exact command retained after an ambiguous response so retry cannot duplicate the message. */
	private _pendingMessage: SubmitConversationMessageCommand | null = null;
	/** Whether a conversation command is active. */
	private readonly _conversationCommandBusy = signal(false);
	/** Browser-safe error for the latest failed operation. */
	private readonly _error = signal<string | null>(null);
	/** Rejects late snapshot and command adoption after selection changes. */
	private _generation = 0;
	/** Stops the currently selected conversation stream. */
	private _streamAbort: AbortController | null = null;
	/** Separate run-status and run-command owner. */
	public readonly runs = inject(ConversationRunStore);
	/** Separate onboarding-history read and selection owner. */
	public readonly history = inject(ConversationOnboardingHistoryStore);

	/** Public route state. */
	public readonly routeState = this._routeState.asReadonly();
	/** Public creation choices. */
	public readonly directory = this._directory.asReadonly();
	/** Public conversation list. */
	public readonly conversations = this._conversations.asReadonly();
	/** Public onboarding history availability and transcript. */
	public readonly onboardingHistory = this.history.projection;
	/** Whether the read-only onboarding transcript is selected. */
	public readonly onboardingHistorySelected = this.history.selected;
	/** Public selected snapshot. */
	public readonly selected = this._selected.asReadonly();
	/** Public live projection. */
	public readonly live = this._live.asReadonly();
	/** Public stream connection phase. */
	public readonly streamStatus = this._streamStatus.asReadonly();
	/** Public controlled message draft. */
	public readonly draft = this._draft.asReadonly();
	/** Public next-conversation mode. */
	public readonly creationMode = this._creationMode.asReadonly();
	/** Public selected human coordinates. */
	public readonly selectedParticipantRefs = this._selectedParticipantRefs.asReadonly();
	/** Public create command state. */
	public readonly creationState = this._creationState.asReadonly();
	/** Public message command state. */
	public readonly sending = this._sending.asReadonly();
	/** Public conversation command state. */
	public readonly conversationCommandBusy = this._conversationCommandBusy.asReadonly();
	/** Public browser-safe error. */
	public readonly error = this._error.asReadonly();
	/** Whether the selected conversation accepts another message. */
	public readonly canSend = computed(this._CanSend.bind(this));
	/** Whether the current create selection is accepted by the selected immutable mode. */
	public readonly canCreate = computed(this._CanCreate.bind(this));

	/** Register component teardown without giving the app root ownership of screen state. */
	public constructor()
	{
		this._destroyRef.onDestroy(this._Abort.bind(this));
	}

	/** Load the privacy-safe creation directory and current conversation list together. */
	public async load(): Promise<void>
	{
		const generation = ++this._generation;
		this._routeState.set(ConversationWorkspaceRouteStates.Loading);
		this._error.set(null);
		try
		{
			const [directory, conversations, onboardingHistory] = await Promise.all([this._gateway.directory(), this._gateway.list(), this.history.load()]);
			if (generation !== this._generation) return;
			this.history.adopt(onboardingHistory);
			this._directory.set(directory);
			this._conversations.set(conversations);
			this._routeState.set(ConversationWorkspaceRouteStates.Ready);
			if (this.history.projection().status === ConversationOnboardingHistoryStatuses.Ready) this.openOnboardingHistory();
			else if (conversations.length > 0) await this.open(conversations[0]!.id);
		}
		catch (error)
		{
			if (generation !== this._generation) return;
			this._routeState.set(ConversationWorkspaceRouteStates.Unavailable);
			this._error.set(_Message(error, "OpenCrane could not load conversations."));
		}
	}

	/** Open one authorized snapshot before tailing the same conversation live. */
	public async open(conversationId: string): Promise<void>
	{
		const generation = ++this._generation;
		const previouslyVisible = this._selected()?.id === conversationId;
		this._Abort();
		this.history.clearSelection();
		this._selected.set(null);
		this._live.set(__CreateAgUiStreamState());
		this.runs.clear();
		this._error.set(null);
		this._streamStatus.set(ConversationEventStreamStatuses.Connecting);
		try
		{
			const detail = await this._gateway.open(conversationId);
			if (generation !== this._generation) return;
			this._selected.set(detail);
			this._draft.set("");
			this._pendingMessage = null;
			this._routeState.set(ConversationWorkspaceRouteStates.Ready);
			this._StartStream(detail.id, generation);
		}
		catch (error)
		{
			if (generation !== this._generation) return;
			this._HandleFailure(error, previouslyVisible);
		}
	}

	/** Select the completed onboarding transcript without opening a conversation stream. */
	public openOnboardingHistory(): void
	{
		if (!this.history.select()) return;
		this._generation += 1;
		this._Abort();
		this._selected.set(null);
		this._live.set(__CreateAgUiStreamState());
		this.runs.clear();
		this._draft.set("");
		this._pendingMessage = null;
		this._streamStatus.set(null);
		this._error.set(null);
	}

	/** Select the immutable mode for a conversation that does not exist yet. */
	public selectCreationMode(mode: ConversationModes): void
	{
		this._creationMode.set(mode);
		this._selectedParticipantRefs.set(new Set());
		this._creationState.set(ConversationCreationStates.Idle);
		this._error.set(null);
	}

	/** Toggle one opaque participant coordinate without displaying its value. */
	public toggleParticipant(participantRef: string): void
	{
		const directory = this._directory();
		const participant = directory?.participants.find(candidate => candidate.participantRef === participantRef && !candidate.isSelf);
		if (participant === undefined) return;
		const selected = new Set(this._selectedParticipantRefs());
		if (selected.has(participantRef)) selected.delete(participantRef);
		else selected.add(participantRef);
		if (this._creationMode() === ConversationModes.Direct && selected.size > 1) this._selectedParticipantRefs.set(new Set([participantRef]));
		else this._selectedParticipantRefs.set(selected);
	}

	/** Create the exact selected immutable mode and adopt its returned snapshot. */
	public async create(): Promise<ConversationWorkspaceNavigationIntent | null>
	{
		const command = this._CreateCommand();
		if (command === null || this._creationState() === ConversationCreationStates.Creating) return null;
		const generation = this._generation;
		this._creationState.set(ConversationCreationStates.Creating);
		this._error.set(null);
		try
		{
			const detail = await this._gateway.create(command);
			this._conversations.update(current => [detail, ...current.filter(candidate => candidate.id !== detail.id)]);
			this._creationState.set(ConversationCreationStates.Idle);
			if (generation !== this._generation) return null;
			return { conversationId: detail.id };
		}
		catch (error)
		{
			this._creationState.set(ConversationCreationStates.Failed);
			this._error.set(_Message(error, "OpenCrane could not create this conversation."));
			return null;
		}
	}

	/** Keep the message composer controlled by this selected conversation. */
	public updateDraft(value: string): void { this._draft.set(value); }

	/** Submit exact text and ready asset references, then reconcile before forgetting the retry key. */
	public async send(assetIds: readonly string[] = []): Promise<boolean>
	{
		const selected = this._selected();
		const text = this._draft().trim();
		if (selected === null || (text.length === 0 && assetIds.length === 0) || !this._CanSend(assetIds.length > 0)) return false;
		const generation = this._generation;
		const command = this._PendingMessageCommand(selected.id, text, assetIds);
		this._sending.set(true);
		this._error.set(null);
		try
		{
			await this._gateway.send(command);
			if (generation !== this._generation) return false;
			const reconciled = await this._gateway.open(selected.id);
			if (generation !== this._generation) return false;
			this._selected.set(reconciled);
			this._draft.set("");
			this._pendingMessage = null;
			return true;
		}
		catch (error)
		{
			if (generation === this._generation) this._HandleFailure(error, true);
			return false;
		}
		finally { if (generation === this._generation) this._sending.set(false); }
	}

	/** Archive the selected row for this participant and return to the remaining list. */
	public async archive(): Promise<ConversationWorkspaceNavigationIntent | null>
	{
		const selected = this._selected();
		if (selected === null || this._conversationCommandBusy()) return null;
		const generation = this._generation;
		this._conversationCommandBusy.set(true);
		try
		{
			const archived = await this._gateway.archive(selected.id, true);
			this._conversations.update(current => current.map(candidate => candidate.id === archived.id ? archived : candidate));
			if (generation !== this._generation || this._selected()?.id !== selected.id) return null;
			this._ClearSelection();
			const next = this._conversations().find(candidate => candidate.archivedAt === null);
			return { conversationId: next?.id ?? null };
		}
		catch (error) { if (generation === this._generation) this._HandleFailure(error, true); }
		finally { this._conversationCommandBusy.set(false); }
		return null;
	}

	/** Permanently close the selected conversation after the server rechecks run state. */
	public async close(): Promise<void>
	{
		const selected = this._selected();
		if (selected === null || this._conversationCommandBusy()) return;
		const generation = this._generation;
		this._conversationCommandBusy.set(true);
		try
		{
			const detail = await this._gateway.close(selected.id);
			if (generation === this._generation && this._selected()?.id === selected.id) this._selected.set(detail);
		}
		catch (error) { if (generation === this._generation) this._HandleFailure(error, true); }
		finally { this._conversationCommandBusy.set(false); }
	}

	/** Start one stream scoped to the current selection generation. */
	private _StartStream(conversationId: string, generation: number): void
	{
		const abort = new AbortController();
		this._streamAbort = abort;
		void this._stream.stream({ conversationId, signal: abort.signal, initialState: this._live(), onUpdate: this._AdoptStreamUpdate.bind(this, generation) }).catch(this._StreamFailed.bind(this, generation));
	}

	/** Adopt stream progress only while it still belongs to the selected snapshot. */
	private _AdoptStreamUpdate(generation: number, update: ConversationEventStreamUpdate): void
	{
		if (generation !== this._generation) return;
		this._streamStatus.set(update.status);
		this._live.set(update.state);
		if (update.state.accessRevoked) { this._PurgeAccess(); return; }
		const runId = update.state.runId;
		const selected = this._selected();
		if (runId !== null && selected !== null) void this.runs.observe(runId, selected.id, update.state.runStatus);
	}

	/** Keep the last good snapshot visible after a bounded stream failure. */
	private _StreamFailed(generation: number, error: unknown): void
	{
		if (generation !== this._generation) return;
		if (this._live().accessRevoked) { this._PurgeAccess(); return; }
		this._streamStatus.set(ConversationEventStreamStatuses.Failed);
		this._error.set(_Message(error, "Live updates stopped. Reopen the conversation to reconnect."));
	}

	/** Convert one failed read or command into route state and safe copy. */
	private _HandleFailure(error: unknown, previouslyVisible: boolean): void
	{
		if (error instanceof ConversationWorkspaceGatewayError && error.kind === ConversationWorkspaceGatewayErrorKinds.AccessChanged && previouslyVisible) { this._PurgeAccess(); return; }
		this._error.set(_Message(error, "OpenCrane could not complete that action."));
		if (!previouslyVisible && error instanceof ConversationWorkspaceGatewayError && error.kind === ConversationWorkspaceGatewayErrorKinds.AccessChanged) this._routeState.set(ConversationWorkspaceRouteStates.Unavailable);
	}

	/** Purge every selected projection after access changes. */
	private _PurgeAccess(): void
	{
		this._Abort();
		this._selected.set(null);
		this._live.set(__CreateAgUiStreamState());
		this.runs.clear();
		this.history.clearSelection();
		this._draft.set("");
		this._pendingMessage = null;
		this._routeState.set(ConversationWorkspaceRouteStates.AccessChanged);
		this._error.set(null);
	}

	/** Clear one selection without changing route availability. */
	private _ClearSelection(): void
	{
		this._generation += 1;
		this._Abort();
		this._selected.set(null);
		this.history.clearSelection();
		this._live.set(__CreateAgUiStreamState());
		this.runs.clear();
		this._draft.set("");
		this._pendingMessage = null;
	}

	/** Stop the current stream without changing any retained view state. */
	private _Abort(): void
	{
		this._streamAbort?.abort();
		this._streamAbort = null;
	}

	/** Whether selected canonical and run state accept a message. */
	private _CanSend(hasAssets = false): boolean
	{
		const selected = this._selected();
		return selected !== null && selected.lifecycle === ConversationLifecycles.Open && selected.accessEndedPosition === null && !this._sending() && (this._draft().trim().length > 0 || hasAssets);
	}

	/** Reuse the exact pending command, or freeze a fresh command from the current composer. */
	private _PendingMessageCommand(conversationId: string, text: string, assetIds: readonly string[]): SubmitConversationMessageCommand
	{
		if (this._pendingMessage !== null && this._pendingMessage.conversationId === conversationId) return this._pendingMessage;
		const textBlocks: readonly SubmitConversationMessageBlock[] = text.length === 0 ? [] : [{ id: globalThis.crypto.randomUUID(), kind: MessageContentBlockKinds.Text, value: text }];
		const assetBlocks: readonly SubmitConversationMessageBlock[] = assetIds.map(function _AssetBlock(assetId) { return { id: globalThis.crypto.randomUUID(), kind: MessageContentBlockKinds.Artifact, value: assetId }; });
		const command: SubmitConversationMessageCommand = { conversationId, idempotencyKey: globalThis.crypto.randomUUID(), blocks: [...textBlocks, ...assetBlocks] };
		this._pendingMessage = command;
		return command;
	}

	/** Whether the creation selection matches the fixed mode's cardinality. */
	private _CanCreate(): boolean
	{
		const directory = this._directory();
		if (directory === null || this._creationState() === ConversationCreationStates.Creating) return false;
		if (this._creationMode() === ConversationModes.AgentSession) return directory.personalAgentStatus === ConversationPersonalAgentStatuses.Ready && directory.personalAgent !== null;
		if (this._creationMode() === ConversationModes.Direct) return this._selectedParticipantRefs().size === 1;
		return this._selectedParticipantRefs().size >= 1;
	}

	/** Build the command only from choices supplied by the current directory. */
	private _CreateCommand(): CreateConversationCommand | null
	{
		if (!this._CanCreate()) return null;
		const mode = this._creationMode();
		const directory = this._directory();
		if (directory === null) return null;
		if (mode === ConversationModes.AgentSession && directory.personalAgent !== null) return { mode, personalAgentRef: directory.personalAgent.personalAgentRef };
		if (mode === ConversationModes.Direct || mode === ConversationModes.Group) return { mode, participantRefs: [...this._selectedParticipantRefs()] };
		return null;
	}

}

/** Reduce an unknown failure to safe existing gateway copy or a fixed fallback. */
function _Message(error: unknown, fallback: string): string
{
	return error instanceof ConversationWorkspaceGatewayError ? error.message : fallback;
}
