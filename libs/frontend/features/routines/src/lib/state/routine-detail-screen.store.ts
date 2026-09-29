import { DestroyRef, Injectable, effect, inject, signal } from "@angular/core";

import { ROUTINE_SESSION } from "@opencrane/state/routines";

import { RoutineControlActions, RoutineReadStates, RoutineSubmitOutcomes } from "../routine-presentation.types";
import { RoutineControlStore } from "./routine-control.store";
import { RoutineDetailStore } from "./routine-detail.store";
import { RoutineEditorStore } from "./routine-editor.store";
import { RoutineHistoryStore } from "./routine-history.store";

/** Coordinates the detail route's target, editor, controls, authoritative refresh, and history. */
@Injectable()
export class RoutineDetailScreenStore
{
	public readonly detail = inject(RoutineDetailStore);
	public readonly history = inject(RoutineHistoryStore);
	public readonly controls = inject(RoutineControlStore);
	public readonly editor = inject(RoutineEditorStore);
	private readonly _session = inject(ROUTINE_SESSION);
	private readonly _destroyRef = inject(DestroyRef);
	public readonly editing = signal(false);
	private _generation = 0;
	private _scope: string | null = null;
	private _accessPurged = false;
	private readonly _sessionEffect = effect(this._SessionChanged.bind(this));
	private readonly _timezoneEffect = effect(this._TimezoneChanged.bind(this));
	private readonly _accessEffect = effect(this._AccessStateChanged.bind(this));

	public constructor() { this._destroyRef.onDestroy(this._Destroyed.bind(this)); }

	/** Selects one bounded route coordinate or immediately removes the previous target. */
	public start(routineId: string | null): void
	{
		this._generation += 1;
		this._scope = this._session();
		this._accessPurged = false;
		this.editing.set(false);
		this.editor.clear();
		if (routineId === null)
		{
			this.detail.clear();
			this.history.clear();
			this.controls.clear();
			return;
		}
		this.detail.start(routineId);
		this.history.start(routineId);
		this.controls.start(routineId);
	}

	/** Starts a controlled revision from the latest authorized detail. */
	public revise(): void
	{
		const detail = this.detail.authorizedDetail();
		if (detail === null)
			return;
		this.editor.startRevision(detail);
		this.editing.set(true);
	}

	/** Closes revision and removes its decrypted draft and retry coordinates. */
	public cancelRevision(): void { this.editor.clear(); this.editing.set(false); }

	/** Submits a revision, preserves conflict drafts, and adopts known committed summaries. */
	public async submitRevision(): Promise<void>
	{
		const generation = this._generation;
		const session = this._session();
		const result = await this.editor.submitRevision();
		if (!this._Current(generation, session))
			return;
		if (result.outcome === RoutineSubmitOutcomes.AccessChanged)
		{
			this._PurgeAccess();
			return;
		}
		if (result.outcome === RoutineSubmitOutcomes.Conflict)
		{
			const refreshed = await this.detail.refresh();
			if (!this._Current(generation, session))
				return;
			const detail = this.detail.authorizedDetail();
			if (refreshed && detail !== null)
				this.editor.acceptRefreshedRevision(detail);
			return;
		}
		if (result.outcome !== RoutineSubmitOutcomes.Committed || result.definition === undefined)
			return;
		this.detail.adoptDefinition(result.definition);
		this.editing.set(false);
		this.editor.clear();
		if (!await this.detail.refresh() && this._Current(generation, session))
			this.detail.markCommittedRefreshFailed();
	}

	/** Runs one control intent and keeps the command admitted through its authoritative refresh. */
	public async control(action: RoutineControlActions): Promise<void>
	{
		const generation = this._generation;
		const session = this._session();
		const detail = this.detail.authorizedDetail();
		if (detail === null)
			return;
		const result = await this.controls.execute(action, detail);
		if (!this._Current(generation, session))
			return;
		if (result.outcome === RoutineSubmitOutcomes.AccessChanged)
		{
			this._PurgeAccess();
			return;
		}
		if (result.outcome === RoutineSubmitOutcomes.Conflict)
		{
			const refreshed = await this.detail.refresh();
			if (!this._Current(generation, session))
				return;
			const current = this.detail.authorizedDetail();
			if (refreshed && current !== null)
				this.controls.acceptRefreshedDetail(current);
			return;
		}
		if (result.outcome !== RoutineSubmitOutcomes.Committed)
			return;
		if (result.definition !== undefined)
			this.detail.adoptDefinition(result.definition);
		const refreshed = await this.detail.refresh();
		if (!this._Current(generation, session))
			return;
		if (!refreshed)
			this.controls.markRefreshFailed();
		await this.history.refresh();
		if (!this._Current(generation, session))
			return;
		if (refreshed)
			this.controls.completeRefresh();
	}

	/** Refreshes details and clears only resolved control conflicts or refresh warnings. */
	public async refreshDetails(): Promise<void>
	{
		const generation = this._generation;
		const session = this._session();
		const refreshed = await this.detail.refresh();
		if (!this._Current(generation, session))
			return;
		const detail = this.detail.authorizedDetail();
		if (refreshed && detail !== null)
			this.controls.acceptRefreshedDetail(detail);
	}

	private _TimezoneChanged(): void
	{
		const detail = this.detail.authorizedDetail();
		if (detail !== null)
			this.history.setTimezone(detail.schedule.timezone);
	}

	private _SessionChanged(): void
	{
		const session = this._session();
		if (session === this._scope)
			return;
		this._scope = session;
		this._accessPurged = false;
		this._generation += 1;
		this.editing.set(false);
	}

	private _AccessStateChanged(): void
	{
		if (!this._accessPurged && (this.detail.currentSessionAccessChanged() || this.history.currentSessionAccessChanged()))
			this._PurgeAccess();
	}

	private _PurgeAccess(): void
	{
		this._accessPurged = true;
		this._generation += 1;
		this.editing.set(false);
		this.editor.clear();
		this.controls.clear();
		this.detail.accessChanged();
		this.history.accessChanged();
	}

	private _Current(generation: number, session: string | null): boolean
	{
		return generation === this._generation && session !== null && session === this._session() && session === this._scope;
	}

	private _Destroyed(): void { this._generation += 1; }
}
