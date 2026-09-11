import { DestroyRef, Injectable, computed, effect, inject, resource, signal, untracked, type ResourceLoaderParams } from "@angular/core";

import { ConversationAuthorKinds, ConversationEntryKinds, ConversationMessageActivations } from "@opencrane/contracts";
import { ConversationModes } from "@opencrane/models/conversations";

import { CONVERSATION_CURRENT_SUBJECT } from "./conversation-workspace.gateway";
import { ConversationWorkspaceGatewayError, ConversationWorkspaceGatewayErrorKinds } from "./conversation-workspace-gateway.errors";
import { CONVERSATION_PERSONAL_RUNS_GATEWAY, ConversationPersonalRunStates, type ConversationPersonalRun, type ConversationPersonalRunsRead, type ConversationPersonalRunsScope, type ConversationWorkStopAttempt, type ConversationWorkStopFailure } from "./conversation-personal-runs.types";
import { ConversationWorkspaceStore } from "./conversation-workspace.store";
import { ConversationWorkspaceRouteStates, type ConversationWorkspaceDetail } from "./conversation-workspace.types";

/**
 * Reads recent personal work for the current authorized chat and fences every returned snapshot.
 * Bounded follow-up reads cover admission and completion occurring just after a history event.
 * Called by: the workspace presenter; provided once per routed page.
 * @see https://angular.dev/guide/signals/resource
 */
@Injectable()
export class ConversationPersonalRunsStore
{
	/** Leaves current permission decisions with the existing public API. */
	private readonly _gateway = inject(CONVERSATION_PERSONAL_RUNS_GATEWAY);
	/** Supplies only authorized selected history and its invalidation coordinates. */
	private readonly _workspace = inject(ConversationWorkspaceStore);
	/** Separates cached responses across identities even when the chat ID is unchanged. */
	private readonly _subject = inject(CONVERSATION_CURRENT_SUBJECT);
	/** Selects the entire read scope; undefined prevents a request. */
	private readonly _scope = computed(this._Scope.bind(this), { equal: _SameScope });
	/** Owns cancellation and loading without copying resource data into another signal. */
	private readonly _read = resource<ConversationPersonalRunsRead, ConversationPersonalRunsScope | undefined>({ params: this._scope, loader: this._Load.bind(this) });
	/** Accepts a value only while every scope coordinate still matches. */
	private readonly _current = computed(this._Current.bind(this));
	/** Stops timed refresh when the scope changes or the page is destroyed. */
	private _timer: ReturnType<typeof setTimeout> | null = null;
	/** Retains only refresh-control coordinates, never private run rows. */
	private _refreshScope: ConversationPersonalRunsScope | undefined;
	/** Caps follow-up reads to one minute after a new history checkpoint. */
	private _refreshesRemaining = 12;
	/** Stops automatic follow-up after one minute even when a response takes longer than expected. */
	private _refreshDeadline = 0;
	/** Prevents a failed access read from being retried by a later event in the same selection. */
	private _deniedScope: ConversationPersonalRunsScope | undefined;
	/** Stop command retained across an ambiguous retry for one exact run attempt. */
	private _stopCommand: ConversationWorkStopAttempt | null = null;
	/** True only while the retained Stop command is in flight. */
	private readonly _stopBusy = signal(false);
	/** True after Stop was requested and before authoritative lifecycle settles it. */
	private readonly _stopPending = signal(false);
	/** Fixed display-safe Stop failure retained for an explicit retry. */
	private readonly _stopError = signal<ConversationWorkStopFailure | null>(null);
	/** Ends the confirmation wait when an accepted message has no visible lifecycle result. */
	private _stopConfirmationTimer: ReturnType<typeof setTimeout> | null = null;
	/** Selection whose Stop command proved current access loss. */
	private readonly _stopAccessLostSelection = signal<ConversationWorkspaceDetail | null>(null);
	/** Bridges accepted read progress to one bounded timer. */
	private readonly _refreshEffect = effect(this._Schedule.bind(this));
	/** Purges or settles Stop interaction state from current scope and authoritative lifecycle. */
	private readonly _stopLifecycleEffect = effect(this._ReconcileStopLifecycle.bind(this));
	/** Whether this selection has a personal recent-work surface. */
	public readonly eligible = computed(() => this._scope() !== undefined);
	/** Exposes only currently selected, validated run rows. */
	public readonly runs = computed(() => this._stopAccessLostSelection() === this._scope()?.selection ? [] : this._current()?.runs ?? []);
	/** Reports an active read without implying any change in the run's lifecycle. */
	public readonly loading = this._read.isLoading;
	/** Keeps a fixed error in the scope that produced it. */
	public readonly error = computed(() => this._current()?.error ?? null);
	/** Requires a new authorized selection after access was denied. */
	public readonly accessChanged = computed(() => this._stopAccessLostSelection() === this._scope()?.selection || (this._current()?.accessChanged ?? false));
	/** Newest authoritative run for the selected personal conversation. */
	public readonly currentRun = computed(this._CurrentRun.bind(this));
	/** Whether one Stop request is currently being submitted. */
	public readonly stopBusy = this._stopBusy.asReadonly();
	/** Whether a Stop request is waiting for authoritative run reconciliation. */
	public readonly stopPending = this._stopPending.asReadonly();
	/** Fixed Stop failure, or null when the latest command has no known failure. */
	public readonly stopError = computed(() =>
	{
		const failure = this._stopError();
		const run = this.currentRun();
		return failure !== null && this._scope()?.selection === failure.command.selection && run?.runId === failure.command.runId && run?.attempt === failure.command.attempt ? failure.message : null;
	});

	/** Cancels follow-up work when the owning route leaves. */
	public constructor()
	{
		const destroyRef = inject(DestroyRef);
		destroyRef.onDestroy(this._CancelTimer.bind(this));
		destroyRef.onDestroy(this._CancelStopConfirmation.bind(this));
	}

	/** Retries only this status read; it never retries or mutates assistant execution. */
	public refresh(): void
	{
		if (this._scope() === undefined || this.accessChanged())
			return;
		this._CancelTimer();
		this._read.reload();
	}

	/**
	 * Request Stop for the newest eligible run in the selected personal conversation.
	 *
	 * The command UUID remains stable after an ambiguous failure. A successful HTTP acknowledgement is
	 * only admission of the control message; this method reloads current run state and leaves completion
	 * to the authoritative `cancelling` or terminal projection.
	 *
	 * Called by: `ConversationWorkspacePresenter.stopCurrentWork` from the run-action component.
	 *
	 * @returns True when the server accepted the control message, false for refused, failed, stale, or
	 *   already-pending requests.
	 */
	public async requestStop(): Promise<boolean>
	{
		const run = this.currentRun();
		const scope = this._scope();
		if (run === null || scope === undefined || !_CanStop(run.state) || this._stopBusy() || (this._stopPending() && this._stopError() === null))
			return false;
		const retained = this._stopCommand;
		const command: ConversationWorkStopAttempt = retained !== null && retained.selection === scope.selection && retained.runId === run.runId && retained.attempt === run.attempt
			? retained
			: { conversationId: scope.selection.id, idempotencyKey: globalThis.crypto.randomUUID(), runId: run.runId, attempt: run.attempt, selection: scope.selection };
		this._stopCommand = command;
		this._stopBusy.set(true);
		this._stopPending.set(true);
		this._stopError.set(null);
		try
		{
			await this._gateway.requestStop(command);
			if (!this._StopScopeCurrent(command))
				return false;
			this._AwaitStopConfirmation(command);
			this.refresh();
			return true;
		}
		catch (error)
		{
			if (!this._StopScopeCurrent(command))
				return false;
			if (error instanceof ConversationWorkspaceGatewayError && error.kind === ConversationWorkspaceGatewayErrorKinds.AccessChanged)
			{
				this._deniedScope = scope;
				this._stopAccessLostSelection.set(scope.selection);
				this._ClearStop();
				this._read.reload();
				return false;
			}
			if (error instanceof ConversationWorkspaceGatewayError && error.kind === ConversationWorkspaceGatewayErrorKinds.Conflict)
				this._ClearStop();
			this._stopError.set({ command, message: error instanceof ConversationWorkspaceGatewayError && error.kind === ConversationWorkspaceGatewayErrorKinds.Conflict
				? "Work changed before Stop was accepted. Check its current status and try again if it is still active."
				: "OpenCrane could not confirm the Stop request. Try again to reconcile the same request." });
			this.refresh();
			return false;
		}
		finally
		{
			if (this._StopScopeCurrent(command))
				this._stopBusy.set(false);
		}
	}

	/** Restricts presentation to personal agent chats with current participant access. */
	private _Scope(): ConversationPersonalRunsScope | undefined
	{
		const selection = this._workspace.selected();
		const subject = this._subject();
		if (subject === null || selection === null || this._workspace.routeState() !== ConversationWorkspaceRouteStates.Ready || selection.mode !== ConversationModes.AgentSession || selection.parent !== null || selection.accessEndedPosition !== null)
			return undefined;
		return { selection, subject, position: this._workspace.live().nextPosition };
	}

	/** Filters the global bounded index before any result enters this page's state. */
	private async _Load({ params, abortSignal }: ResourceLoaderParams<ConversationPersonalRunsScope | undefined>): Promise<ConversationPersonalRunsRead>
	{
		if (_SameSelection(params, this._deniedScope))
			return { ...params, runs: [], error: "Recent activity is no longer available. Reopen the chat to check access.", accessChanged: true };
		try
		{
			const runs = await this._gateway.listPersonalRuns(abortSignal);
			return { ...params, runs: runs.filter(run => run.conversationId === params.selection.id), error: null, accessChanged: false };
		}
		catch (error)
		{
			const accessChanged = error instanceof ConversationWorkspaceGatewayError && error.kind === ConversationWorkspaceGatewayErrorKinds.AccessChanged;
			return { ...params, runs: [], error: accessChanged ? "Recent activity is no longer available. Reopen the chat to check access." : "Recent activity could not be loaded. Try again.", accessChanged };
		}
	}

	/** Rejects late data, including responses whose transport ignored cancellation. */
	private _Current(): ConversationPersonalRunsRead | undefined
	{
		const scope = this._scope();
		if (scope === undefined)
			return undefined;
		const value = this._read.hasValue() ? this._read.value() : undefined;
		return value !== undefined && _SameSelection(scope, value) && scope.position === value.position ? value : undefined;
	}

	/** Select the newest accepted run without trusting transport ordering. */
	private _CurrentRun(): ConversationPersonalRun | null
	{
		const runs = this.runs();
		if (runs.length === 0)
			return null;
		return runs.reduce(function _Newest(current, candidate) { return Date.parse(candidate.acceptedAt) > Date.parse(current.acceptedAt) ? candidate : current; });
	}

	/** Clear stale interaction state or settle it only from authoritative run lifecycle. */
	private _ReconcileStopLifecycle(): void
	{
		const scope = this._scope();
		if (this._stopAccessLostSelection() !== null && this._stopAccessLostSelection() !== scope?.selection)
			this._stopAccessLostSelection.set(null);
		const failure = this._stopError();
		const currentRun = this.currentRun();
		if (failure !== null && (scope?.selection !== failure.command.selection || currentRun !== null && (currentRun.runId !== failure.command.runId || currentRun.attempt !== failure.command.attempt)))
			this._stopError.set(null);
		const command = this._stopCommand;
		const stopPending = this._stopPending();
		if (command === null || !stopPending)
			return;
		if (scope === undefined || scope.selection !== command.selection)
		{
			this._ClearStop();
			return;
		}
		const current = this._current();
		if (current === undefined)
			return;
		const run = current.runs.find(candidate => candidate.runId === command.runId && candidate.attempt === command.attempt);
		if (run !== undefined && _CanStop(run.state))
			return;
		if (run !== undefined)
		{
			this._ClearStop();
			return;
		}
		if (failure === null)
			this._stopError.set({ command, message: "OpenCrane could not confirm the stopped work in the current activity list." });
	}

	/** Verify that a mutation completion still belongs to its original selection and run attempt. */
	private _StopScopeCurrent(command: ConversationWorkStopAttempt): boolean
	{
		const scope = this._scope();
		return this._stopCommand === command && scope !== undefined && scope.selection === command.selection && this.currentRun()?.runId === command.runId && this.currentRun()?.attempt === command.attempt;
	}

	/** Purge all private Stop command state. */
	private _ClearStop(): void
	{
		this._CancelStopConfirmation();
		this._stopCommand = null;
		this._stopBusy.set(false);
		this._stopPending.set(false);
		this._stopError.set(null);
	}

	/** Allow a minute for asynchronous admission, even when the page's previous refresh window ended. */
	private _AwaitStopConfirmation(command: ConversationWorkStopAttempt): void
	{
		this._CancelStopConfirmation();
		this._refreshesRemaining = 12;
		this._refreshDeadline = Date.now() + 60_000;
		this._stopConfirmationTimer = setTimeout(this._StopConfirmationExpired.bind(this, command), 60_000);
	}

	/**
	 * Release an acknowledged message's retry key when no lifecycle result was confirmed in time.
	 * The server may have denied it after HTTP admission. A later explicit click submits a fresh Stop;
	 * ambiguous HTTP failures never start this timer and continue using their original key.
	 */
	private _StopConfirmationExpired(command: ConversationWorkStopAttempt): void
	{
		if (this._stopCommand !== command || this._scope()?.selection !== command.selection)
			return;
		this._ClearStop();
		this._stopError.set({ command, message: "Stop has not been confirmed. Check the current status and try again if work is still active." });
	}

	/** Cancel the confirmation deadline when its command settles, changes selection, or leaves the page. */
	private _CancelStopConfirmation(): void
	{
		if (this._stopConfirmationTimer !== null)
			clearTimeout(this._stopConfirmationTimer);
		this._stopConfirmationTimer = null;
	}

	/** Refreshes active work or a new input awaiting admission, then stops without an endless poll. */
	private _Schedule(): void
	{
		this._CancelTimer();
		const scope = this._scope();
		const value = this._current();
		if (scope !== this._refreshScope)
		{
			this._refreshScope = scope;
			this._refreshesRemaining = 12;
			this._refreshDeadline = Date.now() + 60_000;
		}
		if (scope === undefined || value === undefined || this.loading())
			return;
		if (value.accessChanged)
			this._deniedScope = scope;
		if (value.error !== null || this._refreshesRemaining <= 0 || Date.now() >= this._refreshDeadline)
			return;
		const active = value.runs.some(_Active);
		const input = [...untracked(this._workspace.live).entries].reverse().find(entry => entry.kind === ConversationEntryKinds.Message && entry.author.kind === ConversationAuthorKinds.Human && entry.activation === ConversationMessageActivations.Start);
		const awaitingAdmission = input !== undefined && !value.runs.some(run => Date.parse(run.acceptedAt) >= Date.parse(input.occurredAt));
		if (!active && !awaitingAdmission)
			return;
		this._timer = setTimeout(this._RefreshActive.bind(this), Math.min(5_000, this._refreshDeadline - Date.now()));
	}

	/** Counts an automatic read only when its timer fires before the deadline. */
	private _RefreshActive(): void
	{
		if (Date.now() >= this._refreshDeadline)
			return;
		this._refreshesRemaining -= 1;
		this.refresh();
	}

	/** Stops the owned timer without changing any authoritative projection. */
	private _CancelTimer(): void
	{
		if (this._timer !== null)
			clearTimeout(this._timer);
		this._timer = null;
	}
}

/** Compares object identity as well as subject so reopening the same ID creates a new access epoch. */
function _SameSelection(left: ConversationPersonalRunsScope, right: ConversationPersonalRunsScope | undefined): boolean { return right !== undefined && left.selection === right.selection && left.subject === right.subject; }

/** Prevents unchanged stream heartbeats from starting another read or renewing its refresh window. */
function _SameScope(left: ConversationPersonalRunsScope | undefined, right: ConversationPersonalRunsScope | undefined): boolean { return left === right || left !== undefined && right !== undefined && _SameSelection(left, right) && left.position === right.position; }

/** Selects only actively progressing lifecycle states for bounded follow-up reads. */
function _Active(run: ConversationPersonalRun): boolean { return _CanStop(run.state) || run.state === ConversationPersonalRunStates.Queued || run.state === ConversationPersonalRunStates.Assigned || run.state === ConversationPersonalRunStates.Cancelling; }

/** Keep Stop visible only for lifecycle states where current work remains active. */
function _CanStop(state: ConversationPersonalRun["state"]): boolean
{
	switch (state)
	{
		case ConversationPersonalRunStates.Accepted:
		case ConversationPersonalRunStates.Running:
		case ConversationPersonalRunStates.WaitingForInput:
		case ConversationPersonalRunStates.RecoveryRequired: return true;
		default: return false;
	}
}
