import { DestroyRef, Injectable, inject, signal } from "@angular/core";

import { ConversationLifecycles, ConversationModes, GroupChildStates, type GroupChildCreateCommand, type GroupChildShareCommand, type GroupChildView } from "@opencrane/models/conversations";

import { ConversationWorkspaceGatewayError, ConversationWorkspaceGatewayErrorKinds } from "./conversation-workspace-gateway.errors";
import { CONVERSATION_GROUP_CHILD_GATEWAY } from "./conversation-workspace.gateway";
import { ConversationGroupCommandStates, type ConversationGroupSource } from "./conversation-group-child.types";
import type { ConversationWorkspaceDetail } from "./conversation-workspace.types";

/**
 * Keeps company-assistant requests and reviewed shares within the selected conversation.
 * Each unchanged command retains its UUID after a lost response. Selection changes abort reads,
 * discard drafts, and fence late writes; the API remains responsible for current authority.
 * Called by: ConversationWorkspacePresenter and the workspace page's request/share controls.
 */
@Injectable()
export class ConversationGroupChildStore
{
	/** Uses the cookie-authenticated adapter supplied by the app. */
	private readonly _gateway = inject(CONVERSATION_GROUP_CHILD_GATEWAY);
	/** Ends pending refreshes when the page is destroyed. */
	private readonly _destroyRef = inject(DestroyRef);
	/** Holds the selected authorized detail without subscribing the composing effect to command state. */
	private _selection: ConversationWorkspaceDetail | null = null;
	/** Keeps a denied selection stopped until the workspace explicitly leaves or reopens it. */
	private _deniedConversationId: string | null = null;
	/** Cancels work belonging to the previous selection. */
	private _abort = new AbortController();
	/** Fences a list response started before a new child was accepted. */
	private _listRevision = 0;
	/** Prevents overlapping child-list requests. */
	private _reading = false;
	/** Schedules refreshes only while a child still awaits creation. */
	private _refreshTimer: ReturnType<typeof setTimeout> | null = null;
	/** Limits automatic refreshes to one minute before requiring an explicit refresh. */
	private _refreshesRemaining = 12;
	/** Preserves the submitted request after an uncertain response. */
	private _pendingCreate: GroupChildCreateCommand | null = null;
	/** Preserves the reviewed share after an uncertain response. */
	private _pendingShare: GroupChildShareCommand | null = null;
	/** Shows server-confirmed child creation progress for the selected group. */
	public readonly children = signal<readonly GroupChildView[]>([]);
	/** Shows whether the child list is being refreshed. */
	public readonly loading = signal(false);
	/** Holds display copy for a failed child-list read. */
	public readonly error = signal<string | null>(null);
	/** Selects the group message shown by the request dialog. */
	public readonly requestSource = signal<ConversationGroupSource | null>(null);
	/** Holds the participant's explicit company assistant selection. */
	public readonly agentServiceId = signal<string | null>(null);
	/** Locks request input while its command is in flight. */
	public readonly requestState = signal(ConversationGroupCommandStates.Idle);
	/** Holds display copy for a failed request without discarding retry input. */
	public readonly requestError = signal<string | null>(null);
	/** Selects the assistant response being reviewed for a human share. */
	public readonly shareSource = signal<ConversationGroupSource | null>(null);
	/** Retains the participant's edited text across a retry. */
	public readonly shareText = signal("");
	/** Distinguishes a reviewed draft, pending write, failure, and accepted human share. */
	public readonly shareState = signal(ConversationGroupCommandStates.Idle);
	/** Holds display copy for a failed share without exposing server errors. */
	public readonly shareError = signal<string | null>(null);

	/** Registers disposal of the selected conversation's requests and timer. */
	public constructor() { this._destroyRef.onDestroy(this._Reset.bind(this)); }

	/** Selects a conversation and purges commands before any new child read starts. */
	public select(detail: ConversationWorkspaceDetail | null): void
	{
		if (detail !== null && this._deniedConversationId === detail.id)
			return;
		this._deniedConversationId = null;
		if (this._selection?.id === detail?.id && this._selection?.lifecycle === detail?.lifecycle && this._selection?.accessEndedPosition === detail?.accessEndedPosition)
			return;
		this._Reset();
		this._selection = detail;
		if (detail?.mode === ConversationModes.Group && detail.accessEndedPosition === null)
			void this.refresh();
	}

	/** Reads current child states, with a finite refresh window for pending creation. */
	public async refresh(): Promise<void>
	{
		const selected = this._selection;
		if (selected?.mode !== ConversationModes.Group || this._reading)
			return;
		this._CancelTimer();
		this._reading = true;
		this.loading.set(true);
		this.error.set(null);
		const signal = this._abort.signal;
		const revision = this._listRevision;
		try
		{
			const children = await this._gateway.listChildren(selected.id, signal);
			if (this._Current(signal) && revision === this._listRevision)
			{
				this.children.set(children);
				this._ScheduleRefresh();
			}
		}
		catch (error) { if (this._Current(signal))
			this._Failure(error, this.error, "Assistant requests could not be refreshed. Try again."); }
		finally { if (this._Current(signal))
			{ this._reading = false; this.loading.set(false); } }
	}

	/** Opens the selected visible message without choosing a company assistant on the person's behalf. */
	public ask(source: ConversationGroupSource): void
	{
		if (!this._CanRequest() || this.requestState() === ConversationGroupCommandStates.Submitting)
			return;
		if (this.requestSource()?.entryId !== source.entryId)
		{
			this._pendingCreate = null;
			this.agentServiceId.set(null);
			this.requestState.set(ConversationGroupCommandStates.Idle);
			this.requestError.set(null);
		}
		this.requestSource.set(source);
	}

	/** Changes the explicit service selection and starts a new intent when it differs. */
	public chooseAssistant(agentServiceId: string): void
	{
		if (this.requestState() === ConversationGroupCommandStates.Submitting || this.agentServiceId() === agentServiceId)
			return;
		this.agentServiceId.set(agentServiceId);
		this._pendingCreate = null;
		this.requestState.set(ConversationGroupCommandStates.Idle);
		this.requestError.set(null);
	}

	/** Dismisses an editable request; an in-flight command keeps its review visible. */
	public dismissRequest(): void
	{
		if (this.requestState() !== ConversationGroupCommandStates.Submitting)
			this.requestSource.set(null);
	}

	/** Submits the chosen source and service, reusing an unchanged command after a lost response. */
	public async create(): Promise<void>
	{
		const selected = this._selection;
		const source = this.requestSource();
		const agentServiceId = this.agentServiceId();
		if (!this._CanRequest() || selected === null || source === null || agentServiceId === null || this.requestState() === ConversationGroupCommandStates.Submitting)
			return;
		const previous = this._pendingCreate;
		const same = previous?.parentMessageId === source.entryId && previous.parentMessagePosition === source.position && previous.agentServiceId === agentServiceId;
		const command: GroupChildCreateCommand = { parentMessageId: source.entryId, parentMessagePosition: source.position, agentServiceId, idempotencyKey: same ? previous.idempotencyKey : crypto.randomUUID() };
		this._pendingCreate = command;
		this.requestState.set(ConversationGroupCommandStates.Submitting);
		this.requestError.set(null);
		const signal = this._abort.signal;
		try
		{
			const child = await this._gateway.createChild(selected.id, command, signal);
			if (!this._Current(signal))
				return;
			this._listRevision += 1;
			this.children.update(children => [...children.filter(item => item.conversationId !== child.conversationId), child]);
			this.requestSource.set(null);
			this._pendingCreate = null;
			this.requestState.set(ConversationGroupCommandStates.Idle);
			this._refreshesRemaining = 12;
			this._ScheduleRefresh();
		}
		catch (error) { if (this._Current(signal))
			{ this.requestState.set(ConversationGroupCommandStates.Failed); this._Failure(error, this.requestError, "The assistant request could not be confirmed. Try again."); } }
	}

	/** Opens an assistant response as editable text that must be explicitly shared by the human. */
	public reviewShare(source: ConversationGroupSource): void
	{
		if (this._selection?.parent == null || this._selection.accessEndedPosition !== null || this.shareState() === ConversationGroupCommandStates.Submitting)
			return;
		if (this.shareSource()?.entryId !== source.entryId)
		{
			this.shareText.set(source.text);
			this._pendingShare = null;
			this.shareState.set(ConversationGroupCommandStates.Idle);
			this.shareError.set(null);
		}
		this.shareSource.set(source);
	}

	/** Keeps reviewed text and its UUID together; editing creates a different share intent. */
	public editShare(text: string): void
	{
		if (this.shareState() === ConversationGroupCommandStates.Submitting || this.shareText() === text)
			return;
		this.shareText.set(text);
		this._pendingShare = null;
		this.shareState.set(ConversationGroupCommandStates.Idle);
		this.shareError.set(null);
	}

	/** Closes the review after the request finishes. */
	public dismissShare(): void
	{
		if (this.shareState() !== ConversationGroupCommandStates.Submitting)
			this.shareSource.set(null);
	}

	/** Shares the reviewed text as the human actor, keeping the same command on an uncertain retry. */
	public async share(): Promise<void>
	{
		const selected = this._selection;
		const source = this.shareSource();
		const text = this.shareText();
		if (selected?.parent == null || source === null || !text.trim() || new TextEncoder().encode(text).byteLength > 65_536 || this.shareState() === ConversationGroupCommandStates.Submitting || this.shareState() === ConversationGroupCommandStates.Accepted)
			return;
		const command = this._pendingShare ?? { sourceEntryId: source.entryId, sourcePosition: source.position, text, idempotencyKey: crypto.randomUUID() };
		this._pendingShare = command;
		this.shareState.set(ConversationGroupCommandStates.Submitting);
		this.shareError.set(null);
		const signal = this._abort.signal;
		try
		{
			await this._gateway.shareChild(selected.id, command, signal);
			if (this._Current(signal))
				this.shareState.set(ConversationGroupCommandStates.Accepted);
		}
		catch (error) { if (this._Current(signal))
			{ this.shareState.set(ConversationGroupCommandStates.Failed); this._Failure(error, this.shareError, "The share could not be confirmed. Your reviewed text is kept for retry."); } }
	}

	/** Returns a navigable child only after the server confirms that creation finished. */
	public childToOpen(conversationId: string): string | null
	{
		return this.children().find(child => child.conversationId === conversationId && child.state === GroupChildStates.Ready)?.conversationId ?? null;
	}

	/** Checks presentation prerequisites without replacing server permission checks. */
	private _CanRequest(): boolean { return this._selection?.mode === ConversationModes.Group && this._selection.lifecycle === ConversationLifecycles.Open && this._selection.accessEndedPosition === null; }
	/** Refuses results after an abort even if the transport resolves instead of throwing. */
	private _Current(signal: AbortSignal): boolean { return this._abort.signal === signal && !signal.aborted; }
	/** Stops the current timer before an explicit refresh or selection change. */
	private _CancelTimer(): void
	{
		if (this._refreshTimer !== null)
			clearTimeout(this._refreshTimer);
		this._refreshTimer = null;
	}
	/** Refreshes pending creation at five-second intervals, at most twelve times per selected group. */
	private _ScheduleRefresh(): void
	{
		this._CancelTimer();
		if (this._refreshesRemaining <= 0 || !this.children().some(child => child.state === GroupChildStates.Pending))
			return;
		this._refreshesRemaining -= 1;
		this._refreshTimer = setTimeout(this.refresh.bind(this), 5_000);
	}
	/** Purges child state on denied access; other failures retain the reviewed command for retry. */
	private _Failure(error: unknown, destination: { set(value: string | null): void }, message: string): void
	{
		if (error instanceof ConversationWorkspaceGatewayError && error.kind === ConversationWorkspaceGatewayErrorKinds.AccessChanged)
		{
			this._deniedConversationId = this._selection?.id ?? null;
			this._Reset();
			this.error.set("These assistant conversations are no longer available. Reopen the chat to check access.");
			return;
		}
		destination.set(message);
	}
	/** Aborts every pending operation before deleting child requests and reviewed drafts. */
	private _Reset(): void
	{
		this._abort.abort();
		this._abort = new AbortController();
		this._CancelTimer();
		this._selection = null;
		this._reading = false;
		this._listRevision += 1;
		this._refreshesRemaining = 12;
		this._pendingCreate = null;
		this._pendingShare = null;
		this.children.set([]);
		this.loading.set(false);
		this.error.set(null);
		this.requestSource.set(null);
		this.agentServiceId.set(null);
		this.requestState.set(ConversationGroupCommandStates.Idle);
		this.requestError.set(null);
		this.shareSource.set(null);
		this.shareText.set("");
		this.shareState.set(ConversationGroupCommandStates.Idle);
		this.shareError.set(null);
	}
}
