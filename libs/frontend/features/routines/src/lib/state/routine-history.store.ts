import { DestroyRef, Injectable, computed, effect, inject, signal } from "@angular/core";

import { ROUTINE_GATEWAY, ROUTINE_SESSION, RoutineGatewayError, RoutineGatewayErrorKinds, type RoutineFiringPage } from "@opencrane/state/routines";

import { _RoutineHistoryRows } from "../routine-presentation.mapper";
import { RoutineReadStates } from "../routine-presentation.types";

/** Owns sparse firing-history reads for one authorized routine. */
@Injectable()
export class RoutineHistoryStore
{
	private readonly _gateway = inject(ROUTINE_GATEWAY);
	private readonly _session = inject(ROUTINE_SESSION);
	private readonly _destroyRef = inject(DestroyRef);
	private readonly _page = signal<RoutineFiringPage | null>(null);
	private readonly _timezone = signal("UTC");
	private _routineId: string | null = null;
	private _scope: string | null = null;
	private _abort: AbortController | null = null;
	private readonly _sessionEffect = effect(this._SessionChanged.bind(this));
	public readonly state = signal(RoutineReadStates.Idle);
	public readonly error = signal<string | null>(null);
	/** Whether the current signed-in session, rather than a previous session, lost history access. */
	public readonly currentSessionAccessChanged = computed(() => this._session() === this._scope && this.state() === RoutineReadStates.AccessChanged);
	public readonly loadingMore = signal(false);
	public readonly loadMoreError = signal<string | null>(null);
	public readonly rows = computed(() => this._session() !== this._scope || this._page() === null ? [] : _RoutineHistoryRows(this._page()!, this._timezone()));
	public readonly hasMore = computed(() => this._session() === this._scope && this._page()?.nextCursor !== undefined);

	public constructor() { this._destroyRef.onDestroy(this._Dispose.bind(this)); }

	/** Selects one routine and begins its history read. */
	public start(routineId: string, timezone = "UTC"): void
	{
		if (routineId === this._routineId && this._scope === this._session())
		{
			this._timezone.set(timezone);
			return;
		}
		this._Purge(RoutineReadStates.Idle);
		this._routineId = routineId;
		this._timezone.set(timezone);
		this._scope = this._session();
		void this.refresh();
	}

	/** Removes the previous route target and every retained firing row. */
	public clear(): void { this._routineId = null; this._Purge(RoutineReadStates.Idle); }

	/** Removes firing rows after current authority is lost. */
	public accessChanged(): void { this._Purge(RoutineReadStates.AccessChanged); }

	/** Updates display timezone after the authorized detail arrives. */
	public setTimezone(timezone: string): void { this._timezone.set(timezone); }

	/** Starts firing history from its first sparse candidate page. */
	public async refresh(): Promise<void>
	{
		const session = this._session();
		const routineId = this._routineId;
		if (session === null || routineId === null || this.state() === RoutineReadStates.Loading || this.state() === RoutineReadStates.Refreshing || this.loadingMore())
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
			const page = await this._gateway.firings(routineId, undefined, abort.signal);
			if (!this._Current(session, routineId, abort))
				return;
			this._page.set(page);
			this.state.set(RoutineReadStates.Ready);
		}
		catch (error) { this._ReadFailed(error, session, routineId, abort, this._page() !== null); }
		finally
		{
			if (this._abort === abort)
				this._abort = null;
		}
	}

	/** Reads the server-owned opaque continuation. */
	public async loadMore(): Promise<void>
	{
		const session = this._session();
		const routineId = this._routineId;
		const previous = this._page();
		const cursor = previous?.nextCursor;
		if (session === null || routineId === null || previous === null || cursor === undefined || this.loadingMore() || this.state() === RoutineReadStates.Loading || this.state() === RoutineReadStates.Refreshing)
			return;
		const abort = new AbortController();
		this._abort = abort;
		this.loadingMore.set(true);
		this.loadMoreError.set(null);
		try
		{
			const page = await this._gateway.firings(routineId, { cursor, limit: previous.limit }, abort.signal);
			if (!this._Current(session, routineId, abort))
				return;
			this._page.set(_CombinePages(previous, page));
		}
		catch (error)
		{
			if (!this._Current(session, routineId, abort) || _Aborted(error))
				return;
			if (_AccessLost(error))
				this._Purge(RoutineReadStates.AccessChanged);
			else
				this.loadMoreError.set("More run history could not be loaded. Try again.");
		}
		finally
		{
			if (this._abort === abort)
				this._abort = null;
			if (this._session() === session)
				this.loadingMore.set(false);
		}
	}

	private _ReadFailed(error: unknown, session: string, routineId: string, abort: AbortController, retained: boolean): void
	{
		if (!this._Current(session, routineId, abort) || _Aborted(error))
			return;
		if (_AccessLost(error))
			this._Purge(RoutineReadStates.AccessChanged);
		else
		{
			this.error.set(retained ? "Run history could not be refreshed. The displayed rows may be out of date." : "Run history is unavailable. Try again.");
			this.state.set(retained ? RoutineReadStates.RetainedError : RoutineReadStates.Unavailable);
		}
	}

	private _SessionChanged(): void
	{
		const session = this._session();
		if (session === this._scope)
			return;
		this._Purge(RoutineReadStates.Idle);
		this._scope = session;
		if (session !== null && this._routineId !== null)
			globalThis.queueMicrotask(this.refresh.bind(this));
	}

	private _Current(session: string, routineId: string, abort: AbortController): boolean
	{
		return this._session() === session && this._scope === session && this._routineId === routineId && this._abort === abort && !abort.signal.aborted;
	}

	private _Purge(state: RoutineReadStates): void
	{
		this._abort?.abort();
		this._abort = null;
		this._page.set(null);
		this.state.set(state);
		this.error.set(null);
		this.loadingMore.set(false);
		this.loadMoreError.set(null);
	}

	private _Dispose(): void { this._abort?.abort(); this._abort = null; }
}

function _CombinePages(previous: RoutineFiringPage, page: RoutineFiringPage): RoutineFiringPage
{
	const base = { items: [...previous.items, ...page.items], limit: page.limit };
	return page.nextCursor === undefined ? base : { ...base, nextCursor: page.nextCursor };
}

function _Aborted(error: unknown): boolean { return error instanceof DOMException && error.name === "AbortError"; }

function _AccessLost(error: unknown): boolean
{
	return error instanceof RoutineGatewayError && (error.kind === RoutineGatewayErrorKinds.Unauthenticated || error.kind === RoutineGatewayErrorKinds.AccessDenied || error.kind === RoutineGatewayErrorKinds.NotFound);
}
