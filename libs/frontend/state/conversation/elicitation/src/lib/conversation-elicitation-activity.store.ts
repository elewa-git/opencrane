import { DOCUMENT } from "@angular/common";
import { DestroyRef, Injectable, computed, inject, signal } from "@angular/core";

import { ElicitationRequestStates, type ConversationElicitation } from "@opencrane/contracts";

import { __MapElicitationActivity } from "./conversation-activity.mapper";
import { ConversationElicitationActivityReadStates } from "./conversation-elicitation-activity.types";
import { ElicitationGatewayError, ElicitationGatewayErrorKinds } from "./elicitation-gateway.errors";
import { ELICITATION_GATEWAY } from "./opencrane-conversation-elicitation.gateway";

/** Time between Activity reads while the owning page is visible. */
const _REFRESH_INTERVAL_MS = 5_000;
/** Longest browser timer delay, used to recheck a far-future deadline without overflowing. */
const _MAX_TIMER_DELAY_MS = 2_147_483_647;

/**
 * Owns the signed-in participant's pending elicitation Activity read.
 *
 * The session identity is a browser cache partition and is never sent as authority. The generated
 * API reads with the current cookie session, and every completion is fenced to the activation that
 * started it. The store polls only while its page is visible and drops a row at its server deadline
 * before asking the server for the resulting state.
 *
 * Lifetime: provide this store on the Activity page or feature shell. {@link deactivate} clears its
 * private state when that owner no longer represents the signed-in session.
 */
@Injectable()
export class ConversationElicitationActivityStore
{
	/** Signed-in elicitation API port. */
	private readonly _gateway = inject(ELICITATION_GATEWAY);
	/** Browser document whose visibility controls recurring reads. */
	private readonly _document = inject(DOCUMENT);
	/** Ends listeners, timers, and reads with the component-scoped injector. */
	private readonly _destroyRef = inject(DestroyRef);
	/** Server projections from the latest successful read. */
	private readonly _elicitations = signal<readonly ConversationElicitation[]>([]);
	/** Current time used by the derived pending-row filter. */
	private readonly _now = signal(Date.now());
	/** Current read lifecycle exposed to the feature shell. */
	private readonly _readState = signal(ConversationElicitationActivityReadStates.Idle);
	/** Browser-safe message for the last failed read. */
	private readonly _error = signal<string | null>(null);
	/** Stable listener reference removed when the store is destroyed. */
	private readonly _visibilityListener = this._VisibilityChanged.bind(this);
	/** Cache partition for the active signed-in session; never sent to the gateway. */
	private _identity: string | null = null;
	/** Increments whenever an activation, visibility pause, or teardown supersedes a read. */
	private _generation = 0;
	/** Cancels the current HTTP read when its activation no longer owns the store. */
	private _abort: AbortController | null = null;
	/** Shares one in-flight read across automatic and explicit refresh attempts. */
	private _read: Promise<void> | null = null;
	/** Schedules the next visible-page refresh after the preceding read settles. */
	private _refreshTimer: ReturnType<typeof setTimeout> | null = null;
	/** Wakes at the nearest pending server deadline. */
	private _expiryTimer: ReturnType<typeof setTimeout> | null = null;
	/** Stops automatic reads after the server says this session no longer owns the Activity index. */
	private _accessChanged = false;
	/** Prevents callbacks from restarting work after component teardown. */
	private _destroyed = false;

	/** Requested and unexpired Activity rows derived from the latest server projections. */
	public readonly rows = computed(this._Rows.bind(this));
	/** Number of pending rows currently visible. */
	public readonly pendingCount = computed(this._PendingCount.bind(this));
	/** Current read lifecycle. */
	public readonly readState = this._readState.asReadonly();
	/** Browser-safe failure message, or null after a successful read or deactivation. */
	public readonly error = this._error.asReadonly();
	/** Whether the visible active session can admit an explicit refresh without overlapping a read. */
	public readonly refreshAvailable = computed(this._RefreshAvailable.bind(this));

	/** Registers the visibility boundary and component-scoped cleanup. */
	public constructor()
	{
		this._document.addEventListener("visibilitychange", this._visibilityListener);
		this._destroyRef.onDestroy(this._Destroy.bind(this));
	}

	/**
	 * Activates the Activity read for one verified browser-session identity.
	 * @param sessionIdentity - Opaque identity key used only to fence private browser state.
	 */
	public activate(sessionIdentity: string): void
	{
		if (sessionIdentity.length === 0 || this._destroyed)
			return;
		if (this._identity === sessionIdentity)
			return;
		this._Reset(sessionIdentity);
		if (this._Visible())
			void this._Refresh(false);
	}

	/** Clears the active cache partition, private rows, timers, and cancellable read. */
	public deactivate(): void
	{
		if (this._destroyed)
			return;
		this._Reset(null);
	}

	/**
	 * Retries the active visible session without overlapping a read already in progress.
	 * @returns Resolves after this read, or the already-running read, settles.
	 */
	public refresh(): Promise<void>
	{
		return this._Refresh(true);
	}

	/** Runs one authority read and schedules the next eligible refresh. */
	private async _Refresh(explicit: boolean): Promise<void>
	{
		if (this._destroyed || this._identity === null || !this._Visible() || this._accessChanged && !explicit)
			return;
		if (this._read !== null)
			return this._read;
		if (explicit)
			this._accessChanged = false;
		this._ClearRefreshTimer();
		const generation = this._generation;
		const identity = this._identity;
		const abort = new AbortController();
		this._abort = abort;
		this._readState.set(this._elicitations().length === 0 ? ConversationElicitationActivityReadStates.Loading : ConversationElicitationActivityReadStates.Refreshing);
		this._error.set(null);
		const read = this._Read(generation, identity, abort.signal);
		this._read = read;
		try { await read; }
		finally
		{
			if (this._read === read)
				this._read = null;
			if (this._abort === abort)
				this._abort = null;
			if (this._Current(generation, identity) && !abort.signal.aborted)
				this._ScheduleRefresh();
		}
	}

	/** Adopts one bounded Activity response when its activation still owns the store. */
	private async _Read(generation: number, identity: string, signal: AbortSignal): Promise<void>
	{
		try
		{
			const elicitations = await this._gateway.listActivity(undefined, signal);
			if (!this._Current(generation, identity) || signal.aborted)
				return;
			this._now.set(Date.now());
			this._elicitations.set(elicitations);
			this._accessChanged = false;
			this._error.set(null);
			this._readState.set(ConversationElicitationActivityReadStates.Ready);
			this._ScheduleExpiry();
		}
		catch (error)
		{
			if (!this._Current(generation, identity) || signal.aborted)
				return;
			this._elicitations.set([]);
			this._ClearExpiryTimer();
			this._accessChanged = error instanceof ElicitationGatewayError && error.kind === ElicitationGatewayErrorKinds.Forbidden;
			this._error.set(this._accessChanged ? "Your access to elicitation activity changed. Refresh to try again." : "OpenCrane could not load elicitation activity.");
			this._readState.set(ConversationElicitationActivityReadStates.Error);
		}
	}

	/** Pauses hidden-page work and starts an immediate read when the page becomes visible. */
	private _VisibilityChanged(): void
	{
		if (!this._Visible())
		{
			this._Pause();
			return;
		}
		this._now.set(Date.now());
		this._ScheduleExpiry();
		if (this._identity !== null && !this._accessChanged)
			void this._Refresh(false);
	}

	/** Cancels a hidden-page read without clearing rows owned by the active session. */
	private _Pause(): void
	{
		this._generation += 1;
		this._abort?.abort();
		this._abort = null;
		this._read = null;
		this._ClearRefreshTimer();
		this._ClearExpiryTimer();
		if (this._identity !== null && this._readState() !== ConversationElicitationActivityReadStates.Error)
			this._readState.set(ConversationElicitationActivityReadStates.Ready);
	}

	/** Replaces the private cache partition synchronously before any new read begins. */
	private _Reset(identity: string | null): void
	{
		this._generation += 1;
		this._abort?.abort();
		this._abort = null;
		this._read = null;
		this._ClearRefreshTimer();
		this._ClearExpiryTimer();
		this._identity = identity;
		this._accessChanged = false;
		this._elicitations.set([]);
		this._now.set(Date.now());
		this._error.set(null);
		this._readState.set(identity === null ? ConversationElicitationActivityReadStates.Idle : ConversationElicitationActivityReadStates.Loading);
	}

	/** Schedules another read five seconds after the last one settled. */
	private _ScheduleRefresh(): void
	{
		this._ClearRefreshTimer();
		if (this._destroyed || this._identity === null || !this._Visible() || this._accessChanged)
			return;
		this._refreshTimer = setTimeout(this._Poll.bind(this), _REFRESH_INTERVAL_MS);
	}

	/** Starts the next recurring read. */
	private _Poll(): void
	{
		this._refreshTimer = null;
		void this._Refresh(false);
	}

	/** Schedules the derived row set to change at its nearest pending deadline. */
	private _ScheduleExpiry(): void
	{
		this._ClearExpiryTimer();
		if (this._identity === null || !this._Visible())
			return;
		const now = Date.now();
		const deadlines = this._elicitations()
			.filter(elicitation => elicitation.state === ElicitationRequestStates.Requested && Date.parse(elicitation.expiresAt) > now)
			.map(elicitation => Date.parse(elicitation.expiresAt));
		if (deadlines.length === 0)
			return;
		const delay = Math.min(Math.max(0, Math.min(...deadlines) - now), _MAX_TIMER_DELAY_MS);
		this._expiryTimer = setTimeout(this._DeadlineReached.bind(this), delay);
	}

	/** Removes expired derived rows, then asks the server for their current state. */
	private _DeadlineReached(): void
	{
		this._expiryTimer = null;
		this._now.set(Date.now());
		this._ScheduleExpiry();
		void this._Refresh(false);
	}

	/** Returns pending rows without changing the authoritative server projections. */
	private _Rows()
	{
		const now = this._now();
		return this._elicitations()
			.filter(elicitation => elicitation.state === ElicitationRequestStates.Requested && Date.parse(elicitation.expiresAt) > now)
			.map(__MapElicitationActivity);
	}

	/** Derives the badge count from the same rows the feature renders. */
	private _PendingCount(): number { return this.rows().length; }

	/** Reports explicit-refresh admission without granting any server authority. */
	private _RefreshAvailable(): boolean
	{
		const state = this._readState();
		return !this._destroyed && this._identity !== null && this._Visible() && state !== ConversationElicitationActivityReadStates.Loading && state !== ConversationElicitationActivityReadStates.Refreshing;
	}

	/** Confirms that a completion still belongs to the same active cache partition. */
	private _Current(generation: number, identity: string): boolean { return !this._destroyed && generation === this._generation && identity === this._identity; }

	/** Reads current document visibility without treating prerendered state as visible. */
	private _Visible(): boolean { return this._document.visibilityState === "visible"; }

	/** Cancels the recurring refresh timer. */
	private _ClearRefreshTimer(): void
	{
		if (this._refreshTimer !== null)
			clearTimeout(this._refreshTimer);
		this._refreshTimer = null;
	}

	/** Cancels the nearest-deadline timer. */
	private _ClearExpiryTimer(): void
	{
		if (this._expiryTimer !== null)
			clearTimeout(this._expiryTimer);
		this._expiryTimer = null;
	}

	/** Removes every browser lifecycle hook owned by this component-scoped store. */
	private _Destroy(): void
	{
		this._Reset(null);
		this._destroyed = true;
		this._document.removeEventListener("visibilitychange", this._visibilityListener);
	}
}
