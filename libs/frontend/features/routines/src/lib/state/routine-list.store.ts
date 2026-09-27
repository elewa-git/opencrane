import { DestroyRef, Injectable, computed, effect, inject, signal } from "@angular/core";

import { ROUTINE_GATEWAY, ROUTINE_SESSION, RoutineGatewayError, RoutineGatewayErrorKinds, type RoutineListPage } from "@opencrane/state/routines";

import { _RoutineListRows } from "../routine-presentation.mapper";
import { RoutineReadStates } from "../routine-presentation.types";

/** Owns authorized routine-list reads, sparse cursors and session-scoped browser retention. */
@Injectable()
export class RoutineListStore
{
	/** Authenticated routine API supplied by app composition. */
	private readonly _gateway = inject(ROUTINE_GATEWAY);
	/** Current session identity used to reject results from an earlier sign-in. */
	private readonly _session = inject(ROUTINE_SESSION);
	/** Route lifetime that cancels transport before this store is destroyed. */
	private readonly _destroyRef = inject(DestroyRef);
	/** Latest successful page sequence retained by this route. */
	private readonly _page = signal<RoutineListPage | null>(null);
	/** Active read cancellation owner. */
	private _abort: AbortController | null = null;
	/** Session captured by the latest request. */
	private _scope: string | null = null;
	/** Reconciles reads and protected browser retention with session changes. */
	private readonly _sessionEffect = effect(this._SessionChanged.bind(this));
	/** Current list read state. */
	public readonly state = signal(RoutineReadStates.Idle);
	/** Safe first-page or refresh failure copy. */
	public readonly error = signal<string | null>(null);
	/** Whether a cursor continuation is pending. */
	public readonly loadingMore = signal(false);
	/** Safe continuation failure copy. */
	public readonly loadMoreError = signal<string | null>(null);
	/** Display rows derived from the latest authorized page sequence. */
	public readonly rows = computed(() => this._session() !== this._scope || this._page() === null ? [] : _RoutineListRows(this._page()!));
	/** Whether the server supplied another opaque cursor. */
	public readonly hasMore = computed(() => this._session() === this._scope && this._page()?.nextCursor !== undefined);

	/** Cancels the active read when route navigation destroys this store. */
	public constructor() { this._destroyRef.onDestroy(this._Dispose.bind(this)); }

	/** Starts from the first candidate page and retains old rows only during an authorized refresh. */
	public async refresh(): Promise<void>
	{
		const session = this._session();
		if (session === null || this.state() === RoutineReadStates.Loading || this.state() === RoutineReadStates.Refreshing || this.loadingMore())
			return;
		this._abort?.abort();
		const abort = new AbortController();
		this._abort = abort;
		this._scope = session;
		this.error.set(null);
		this.loadMoreError.set(null);
		this.state.set(this._page() === null ? RoutineReadStates.Loading : RoutineReadStates.Refreshing);
		try
		{
			const page = await this._gateway.list(undefined, abort.signal);
			if (!this._Current(session, abort))
				return;
			this._page.set(page);
			this.state.set(RoutineReadStates.Ready);
		}
		catch (error)
		{
			if (!this._Current(session, abort) || error instanceof DOMException && error.name === "AbortError")
				return;
			this._ReadFailed(error, this._page() !== null);
		}
		finally
		{
			if (this._abort === abort)
				this._abort = null;
		}
	}

	/** Reads the saved opaque continuation and never fabricates a full-page signal. */
	public async loadMore(): Promise<void>
	{
		const session = this._session();
		const previous = this._page();
		const cursor = previous?.nextCursor;
		if (session === null || previous === null || cursor === undefined || this.loadingMore() || this.state() === RoutineReadStates.Loading || this.state() === RoutineReadStates.Refreshing)
			return;
		const abort = new AbortController();
		this._abort = abort;
		this._scope = session;
		this.loadingMore.set(true);
		this.loadMoreError.set(null);
		try
		{
			const page = await this._gateway.list({ cursor, limit: previous.limit }, abort.signal);
			if (!this._Current(session, abort))
				return;
			this._page.set(_CombinePages(previous, page));
		}
		catch (error)
		{
			if (!this._Current(session, abort) || error instanceof DOMException && error.name === "AbortError")
				return;
			if (this._AccessLost(error))
				this._Purge(RoutineReadStates.AccessChanged);
			else
				this.loadMoreError.set("More routines could not be loaded. Try again.");
		}
		finally
		{
			if (this._abort === abort)
				this._abort = null;
			if (this._session() === session)
				this.loadingMore.set(false);
		}
	}

	/** Starts a first read for a new session and removes the previous session's protected data. */
	private _SessionChanged(): void
	{
		const session = this._session();
		if (session === this._scope)
			return;
		this._Purge(RoutineReadStates.Idle);
		this._scope = session;
		if (session !== null)
			globalThis.queueMicrotask(this.refresh.bind(this));
	}

	/** Rejects results from an aborted request or superseded session. */
	private _Current(session: string, abort: AbortController): boolean
	{
		return this._session() === session && this._scope === session && this._abort === abort && !abort.signal.aborted;
	}

	/** Converts a first-page failure into a safe state without exposing server prose. */
	private _ReadFailed(error: unknown, retained: boolean): void
	{
		if (this._AccessLost(error))
		{
			this._Purge(RoutineReadStates.AccessChanged);
			return;
		}
		this.error.set(retained ? "Routines could not be refreshed. The displayed list may be out of date." : "Routines are unavailable. Try again.");
		this.state.set(retained ? RoutineReadStates.RetainedError : RoutineReadStates.Unavailable);
	}

	/** Identifies current-session failures that require protected state removal. */
	private _AccessLost(error: unknown): boolean
	{
		return error instanceof RoutineGatewayError && (error.kind === RoutineGatewayErrorKinds.Unauthenticated || error.kind === RoutineGatewayErrorKinds.AccessDenied || error.kind === RoutineGatewayErrorKinds.NotFound);
	}

	/** Removes every protected list value and cancels its pending request. */
	private _Purge(state: RoutineReadStates): void
	{
		this._abort?.abort();
		this._abort = null;
		this._page.set(null);
		this.state.set(state);
		this.error.set(null);
		this.loadMoreError.set(null);
		this.loadingMore.set(false);
	}

	/** Cancels route-owned work without changing a later session's navigation. */
	private _Dispose(): void { this._abort?.abort(); this._abort = null; }
}

/** Appends one sparse continuation without materializing an absent optional cursor. */
function _CombinePages(previous: RoutineListPage, page: RoutineListPage): RoutineListPage
{
	const base = { items: [...previous.items, ...page.items], limit: page.limit };
	return page.nextCursor === undefined ? base : { ...base, nextCursor: page.nextCursor };
}
