import { DestroyRef, Injectable, computed, effect, inject, signal } from "@angular/core";

import { ROUTINE_GATEWAY, ROUTINE_SESSION, RoutineGatewayError, RoutineGatewayErrorKinds, type RoutineDefinition, type RoutineDetails } from "@opencrane/state/routines";

import { _RoutineCapabilities, _RoutineDetailsView } from "../routine-presentation.mapper";
import { RoutineReadStates } from "../routine-presentation.types";

/** Owns one authorized detail projection and removes its decrypted values on access changes. */
@Injectable()
export class RoutineDetailStore
{
	private readonly _gateway = inject(ROUTINE_GATEWAY);
	private readonly _session = inject(ROUTINE_SESSION);
	private readonly _destroyRef = inject(DestroyRef);
	private readonly _value = signal<RoutineDetails | null>(null);
	private _routineId: string | null = null;
	private _scope: string | null = null;
	private _abort: AbortController | null = null;
	private readonly _sessionEffect = effect(this._SessionChanged.bind(this));
	public readonly state = signal(RoutineReadStates.Idle);
	public readonly error = signal<string | null>(null);
	/** Whether the current signed-in session, rather than a previous session, lost detail access. */
	public readonly currentSessionAccessChanged = computed(() => this._session() === this._scope && this.state() === RoutineReadStates.AccessChanged);
	public readonly authorizedDetail = computed(() => this._session() === this._scope ? this._value() : null);
	public readonly detail = computed(() => this.authorizedDetail() === null ? null : _RoutineDetailsView(this.authorizedDetail()!));
	public readonly capabilities = computed(() => this.authorizedDetail() === null ? null : _RoutineCapabilities(this.authorizedDetail()!));

	public constructor() { this._destroyRef.onDestroy(this._Dispose.bind(this)); }

	/** Selects one route target and starts its authorized read. */
	public start(routineId: string): void
	{
		if (routineId === this._routineId && this._scope === this._session())
			return;
		this._Purge(RoutineReadStates.Idle);
		this._routineId = routineId;
		this._scope = this._session();
		void this.refresh();
	}

	/** Removes the previous route target and every protected detail value. */
	public clear(): void { this._routineId = null; this._Purge(RoutineReadStates.Idle); }

	/** Removes detail fields after current authority is lost. */
	public accessChanged(): void { this._Purge(RoutineReadStates.AccessChanged); }

	/** Reads the current routine and reports whether fresh details were adopted. */
	public async refresh(): Promise<boolean>
	{
		const session = this._session();
		const routineId = this._routineId;
		if (session === null || routineId === null || this.state() === RoutineReadStates.Loading || this.state() === RoutineReadStates.Refreshing)
			return false;
		this._abort?.abort();
		const abort = new AbortController();
		this._abort = abort;
		this._scope = session;
		this.error.set(null);
		this.state.set(this._value() === null ? RoutineReadStates.Loading : RoutineReadStates.Refreshing);
		try
		{
			const detail = await this._gateway.read(routineId, abort.signal);
			if (!this._Current(session, routineId, abort))
				return false;
			this._value.set(detail);
			this.state.set(RoutineReadStates.Ready);
			return true;
		}
		catch (error)
		{
			if (!this._Current(session, routineId, abort) || _Aborted(error))
				return false;
			if (_AccessLost(error))
				this._Purge(RoutineReadStates.AccessChanged);
			else
			{
				const retained = this._value() !== null;
				this.error.set(retained ? "Routine details could not be refreshed. The displayed values may be out of date." : "Routine details are unavailable. Try again.");
				this.state.set(retained ? RoutineReadStates.RetainedError : RoutineReadStates.Unavailable);
			}
			return false;
		}
		finally
		{
			if (this._abort === abort)
				this._abort = null;
		}
	}

	/** Adopts the authoritative command summary even when the following detail refresh fails. */
	public adoptDefinition(definition: RoutineDefinition): void
	{
		const current = this.authorizedDetail();
		if (current === null || current.routineId !== definition.routineId)
			return;
		this._value.set({ ...current, currentRevision: definition.currentRevision, status: definition.status, lifecycleRevision: definition.lifecycleRevision, nextAutomaticOccurrence: definition.nextAutomaticOccurrence });
		this.state.set(RoutineReadStates.Ready);
		this.error.set(null);
	}

	/** Hides stale definition fields after a committed revision cannot be reread. */
	public markCommittedRefreshFailed(): void
	{
		this._value.set(null);
		this.state.set(RoutineReadStates.CommittedRefreshFailed);
		this.error.set("The revision completed, but current details could not be loaded. Refresh before another action.");
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
		this._value.set(null);
		this.state.set(state);
		this.error.set(null);
	}

	private _Dispose(): void { this._abort?.abort(); this._abort = null; }
}

function _Aborted(error: unknown): boolean { return error instanceof DOMException && error.name === "AbortError"; }

function _AccessLost(error: unknown): boolean
{
	return error instanceof RoutineGatewayError && (error.kind === RoutineGatewayErrorKinds.Unauthenticated || error.kind === RoutineGatewayErrorKinds.AccessDenied || error.kind === RoutineGatewayErrorKinds.NotFound);
}
