import { DestroyRef, Injectable, computed, effect, inject, resource, untracked, type ResourceLoaderParams } from "@angular/core";

import { ConversationModes } from "@opencrane/models/conversations";

import { CONVERSATION_CURRENT_SUBJECT } from "./conversation-workspace.gateway";
import { ConversationWorkspaceGatewayError, ConversationWorkspaceGatewayErrorKinds } from "./conversation-workspace-gateway.errors";
import { CONVERSATION_PERSONAL_RUNS_GATEWAY, type ConversationPersonalRun, type ConversationPersonalRunsRead, type ConversationPersonalRunsScope } from "./conversation-personal-runs.types";
import { ConversationWorkspaceStore } from "./conversation-workspace.store";
import { ConversationWorkspaceRouteStates } from "./conversation-workspace.types";

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
	/** Bridges accepted read progress to one bounded timer. */
	private readonly _refreshEffect = effect(this._Schedule.bind(this));
	/** Whether this selection has a personal recent-work surface. */
	public readonly eligible = computed(() => this._scope() !== undefined);
	/** Exposes only currently selected, validated run rows. */
	public readonly runs = computed(() => this._current()?.runs ?? []);
	/** Reports an active read without implying any change in the run's lifecycle. */
	public readonly loading = this._read.isLoading;
	/** Keeps a fixed error in the scope that produced it. */
	public readonly error = computed(() => this._current()?.error ?? null);
	/** Requires a new authorized selection after access was denied. */
	public readonly accessChanged = computed(() => this._current()?.accessChanged ?? false);

	/** Cancels follow-up work when the owning route leaves. */
	public constructor() { inject(DestroyRef).onDestroy(this._CancelTimer.bind(this)); }

	/** Retries only this status read; it never retries or mutates assistant execution. */
	public refresh(): void
	{
		if (this._scope() === undefined || this.accessChanged())
			return;
		this._CancelTimer();
		this._read.reload();
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
		const value = this._read.hasValue() ? this._read.value() : undefined;
		return scope !== undefined && value !== undefined && _SameSelection(scope, value) && scope.position === value.position ? value : undefined;
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
		const input = [...untracked(this._workspace.live).entries].reverse().find(entry => entry.kind === "message" && entry.author.kind === "human" && entry.activation === "start");
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
function _Active(run: ConversationPersonalRun): boolean { return ["accepted", "queued", "assigned", "running"].includes(run.state); }
