import { DestroyRef, Injectable, computed, effect, inject, signal } from "@angular/core";

import { ROUTINE_GATEWAY, ROUTINE_SESSION, RoutineGatewayError, RoutineGatewayErrorKinds, type RoutineControlCommand, type RoutineDefinition, type RoutineDetails, type RoutineFiring } from "@opencrane/state/routines";

import { RoutineCommandStates, RoutineControlActions, RoutineSubmitOutcomes, type RoutineControlResult } from "../routine-presentation.types";
import { RoutineCommandAdmission, RoutineCommandOwners } from "./routine-command-admission";

type SavedControlCommand = { readonly action: RoutineControlActions; readonly routineId: string; readonly command: RoutineControlCommand };

/** Owns one retry-stable detail command and blocks conflicting mutations before transport starts. */
@Injectable()
export class RoutineControlStore
{
	private readonly _gateway = inject(ROUTINE_GATEWAY);
	private readonly _session = inject(ROUTINE_SESSION);
	private readonly _destroyRef = inject(DestroyRef);
	private readonly _admission = inject(RoutineCommandAdmission);
	private _scope: string | null = null;
	private _routineId: string | null = null;
	private _saved: SavedControlCommand | null = null;
	private _abort: AbortController | null = null;
	private readonly _sessionEffect = effect(this._SessionChanged.bind(this));
	private readonly _state = signal(RoutineCommandStates.Idle);
	private readonly _error = signal<string | null>(null);
	public readonly state = computed(() => this._session() === this._scope ? this._state() : RoutineCommandStates.Idle);
	public readonly error = computed(() => this._session() === this._scope ? this._error() : null);
	/** Exact control action retained for an explicit uncertain retry. */
	public readonly retryAction = computed(() => this._session() === this._scope && this._state() === RoutineCommandStates.Uncertain ? this._saved?.action ?? null : null);

	public constructor() { this._destroyRef.onDestroy(this._Dispose.bind(this)); }

	/** Binds commands to one authorized detail route. */
	public start(routineId: string): void
	{
		if (routineId === this._routineId && this._scope === this._session())
			return;
		this._Reset();
		this._routineId = routineId;
		this._scope = this._session();
	}

	/** Removes the previous route target and any retained retry command. */
	public clear(): void { this._routineId = null; this._Reset(); }

	/** Clears a conflict after the route adopted freshly authorized detail revisions. */
	public acceptRefreshedDetail(detail: RoutineDetails): void
	{
		if (detail.routineId !== this._routineId || this._session() !== this._scope)
			return;
		if (this._state() === RoutineCommandStates.Conflict || this._state() === RoutineCommandStates.CommittedRefreshFailed)
		{
			this._saved = null;
			this._state.set(RoutineCommandStates.Idle);
			this._error.set(null);
			this._admission.release(RoutineCommandOwners.Control);
		}
	}

	/** Executes or explicitly retries one unchanged pause, resume, retire, or run-now command. */
	public async execute(action: RoutineControlActions, detail: RoutineDetails): Promise<RoutineControlResult>
	{
		const session = this._session();
		if (session === null || this._scope !== session || detail.routineId !== this._routineId || this._state() === RoutineCommandStates.Submitting || this._state() === RoutineCommandStates.Conflict || this._state() === RoutineCommandStates.CommittedRefreshFailed)
			return { outcome: RoutineSubmitOutcomes.Rejected };
		if (!this._admission.admit(RoutineCommandOwners.Control))
			return { outcome: RoutineSubmitOutcomes.Rejected };
		if (this._saved !== null && this._saved.action !== action)
			return { outcome: RoutineSubmitOutcomes.Rejected };
		const command = this._saved?.command ?? { expectedLifecycleRevision: detail.lifecycleRevision, idempotencyKey: crypto.randomUUID() };
		this._saved = { action, routineId: detail.routineId, command };
		const abort = new AbortController();
		this._abort = abort;
		this._state.set(RoutineCommandStates.Submitting);
		this._error.set(null);
		try
		{
			const result = await this._Dispatch(action, detail.routineId, command, abort.signal);
			if (!this._Current(session, detail.routineId, abort))
				return { outcome: RoutineSubmitOutcomes.AccessChanged };
			this._saved = null;
			return "firingId" in result ? { outcome: RoutineSubmitOutcomes.Committed, firing: result } : { outcome: RoutineSubmitOutcomes.Committed, definition: result };
		}
		catch (error) { return this._Failed(error, session, detail.routineId, abort); }
		finally
		{
			if (this._abort === abort)
				this._abort = null;
		}
	}

	/** Marks a known committed command whose follow-up read failed. */
	public markRefreshFailed(): void
	{
		if (this._session() !== this._scope)
			return;
		this._state.set(RoutineCommandStates.CommittedRefreshFailed);
		this._error.set("The command completed, but current routine details could not be refreshed. Refresh before another action.");
		this._admission.release(RoutineCommandOwners.Control);
	}

	/** Releases the command boundary after fresh details and history have been adopted. */
	public completeRefresh(): void
	{
		if (this._session() !== this._scope)
			return;
		this._state.set(RoutineCommandStates.Idle);
		this._error.set(null);
		this._admission.release(RoutineCommandOwners.Control);
	}

	private _Dispatch(action: RoutineControlActions, routineId: string, command: RoutineControlCommand, signal: AbortSignal): Promise<RoutineDefinition | RoutineFiring>
	{
		switch (action)
		{
			case RoutineControlActions.Pause: return this._gateway.pause(routineId, command, signal);
			case RoutineControlActions.Resume: return this._gateway.resume(routineId, command, signal);
			case RoutineControlActions.Retire: return this._gateway.retire(routineId, command, signal);
			case RoutineControlActions.RunNow: return this._gateway.runNow(routineId, command, signal);
		}
	}

	private _Failed(error: unknown, session: string, routineId: string, abort: AbortController): RoutineControlResult
	{
		if (!this._Current(session, routineId, abort) || _Aborted(error))
			return { outcome: RoutineSubmitOutcomes.AccessChanged };
		if (_AccessLost(error))
		{
			this._admission.release(RoutineCommandOwners.Control);
			this._Reset();
			return { outcome: RoutineSubmitOutcomes.AccessChanged };
		}
		if (error instanceof RoutineGatewayError && error.kind === RoutineGatewayErrorKinds.Conflict)
		{
			this._saved = null;
			this._state.set(RoutineCommandStates.Conflict);
			this._error.set("The routine changed elsewhere. Refresh its details before trying another action.");
			return { outcome: RoutineSubmitOutcomes.Conflict };
		}
		if (error instanceof RoutineGatewayError && (error.kind === RoutineGatewayErrorKinds.Unavailable || error.kind === RoutineGatewayErrorKinds.Unknown || error.kind === RoutineGatewayErrorKinds.InvalidResponse))
		{
			this._state.set(RoutineCommandStates.Uncertain);
			this._error.set("OpenCrane could not confirm the result. Retry the same action to reuse the same request.");
			return { outcome: RoutineSubmitOutcomes.Uncertain };
		}
		this._saved = null;
		this._admission.release(RoutineCommandOwners.Control);
		this._state.set(RoutineCommandStates.Idle);
		this._error.set("The routine action was rejected. Refresh the details and try again.");
		return { outcome: RoutineSubmitOutcomes.Rejected };
	}

	private _SessionChanged(): void
	{
		const session = this._session();
		if (session === this._scope)
			return;
		this._Reset();
		this._scope = session;
	}

	private _Current(session: string, routineId: string, abort: AbortController): boolean
	{
		return this._session() === session && this._scope === session && this._routineId === routineId && this._abort === abort && !abort.signal.aborted;
	}

	private _Reset(): void
	{
		this._abort?.abort();
		this._abort = null;
		this._saved = null;
		this._admission.release(RoutineCommandOwners.Control);
		this._state.set(RoutineCommandStates.Idle);
		this._error.set(null);
	}

	private _Dispose(): void { this._abort?.abort(); this._abort = null; this._admission.release(RoutineCommandOwners.Control); }
}

function _Aborted(error: unknown): boolean { return error instanceof DOMException && error.name === "AbortError"; }

function _AccessLost(error: unknown): boolean
{
	return error instanceof RoutineGatewayError && (error.kind === RoutineGatewayErrorKinds.Unauthenticated || error.kind === RoutineGatewayErrorKinds.AccessDenied || error.kind === RoutineGatewayErrorKinds.NotFound);
}
