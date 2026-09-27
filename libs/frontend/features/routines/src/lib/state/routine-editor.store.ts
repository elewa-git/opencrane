import { DestroyRef, Injectable, computed, effect, inject, signal } from "@angular/core";

import { ROUTINE_GATEWAY, ROUTINE_SESSION, RoutineGatewayError, RoutineGatewayErrorKinds, type RoutineCreateCommand, type RoutineCreationOptions, type RoutineDefinition, type RoutineDetails, type RoutineReviseCommand, type RoutineSchedule, type RoutineSchedulePreview } from "@opencrane/state/routines";

import { _RoutineCreationChoices } from "../routine-presentation.mapper";
import { RoutineCommandStates, RoutineEditorModes, RoutineReadStates, RoutineSubmitOutcomes, type RoutineDefinitionDraft } from "../routine-presentation.types";
import { _NewRoutineDraft, _RoutinePreviewView, _RoutineRevisionDraft, _RoutineScheduleFromDraft, _RoutineTimezones } from "../routine-schedule";
import { RoutineCommandAdmission, RoutineCommandOwners } from "./routine-command-admission";

/** Retains one unchanged create command across an explicit uncertain retry. */
type SavedCreateCommand = { readonly signature: string; readonly command: RoutineCreateCommand };

/** Retains one unchanged revise command across an explicit uncertain retry. */
type SavedReviseCommand = { readonly signature: string; readonly command: RoutineReviseCommand };

/** Owns routine form choices, authoritative preview and retry-stable create or revise commands. */
@Injectable()
export class RoutineEditorStore
{
	/** Authenticated routine API supplied by app composition. */
	private readonly _gateway = inject(ROUTINE_GATEWAY);
	/** Current session identity used to reject late responses from an earlier sign-in. */
	private readonly _session = inject(ROUTINE_SESSION);
	/** Route lifetime that cancels reads and commands before this store is destroyed. */
	private readonly _destroyRef = inject(DestroyRef);
	/** Shared detail-screen command admission boundary. */
	private readonly _admission = inject(RoutineCommandAdmission);
	/** Current destination conversation for creation. */
	private _destinationConversationId: string | null = null;
	/** Current routine and revision coordinates for revision. */
	private _revision: RoutineDetails | null = null;
	/** Authorized creation choices retained only for the active destination and session. */
	private readonly _options = signal<RoutineCreationOptions | null>(null);
	/** Preview retained only while it matches the current schedule. */
	private readonly _preview = signal<RoutineSchedulePreview | null>(null);
	/** Serialized normalized schedule represented by the retained preview. */
	private _previewSignature: string | null = null;
	/** Read cancellation owner for choices or preview. */
	private _readAbort: AbortController | null = null;
	/** Mutation cancellation owner for route or session changes. */
	private _commandAbort: AbortController | null = null;
	/** Session captured by the current editor. */
	private _scope: string | null = null;
	/** Create command retained for an explicit uncertain retry. */
	private _savedCreate: SavedCreateCommand | null = null;
	/** Revise command retained for an explicit uncertain retry. */
	private _savedRevise: SavedReviseCommand | null = null;
	/** Removes protected editor state when the signed-in session changes. */
	private readonly _sessionEffect = effect(this._SessionChanged.bind(this));
	/** Whether the editor creates or revises. */
	public readonly mode = signal(RoutineEditorModes.Create);
	/** Current controlled form values. */
	private readonly _draft = signal<RoutineDefinitionDraft>(_NewRoutineDraft(null));
	/** Current controlled values, hidden immediately when the session no longer matches. */
	public readonly draft = computed(() => this._session() === this._scope ? this._draft() : _NewRoutineDraft(null));
	/** Creation-choice read state. */
	public readonly optionsState = signal(RoutineReadStates.Idle);
	/** Safe creation-choice failure copy. */
	public readonly optionsError = signal<string | null>(null);
	/** Whether preview is pending. */
	public readonly previewLoading = signal(false);
	/** Safe preview failure copy. */
	public readonly previewError = signal<string | null>(null);
	/** Current mutation state. */
	public readonly commandState = signal(RoutineCommandStates.Idle);
	/** Safe mutation failure copy. */
	public readonly commandError = signal<string | null>(null);
	/** Named browser timezones offered by the form. */
	public readonly timezones = _RoutineTimezones();
	/** Server-approved audience choices. */
	public readonly audienceChoices = computed(() => this._session() !== this._scope || this._options() === null ? [] : _RoutineCreationChoices(this._options()!).audience);
	/** Server-approved managed service choices. */
	public readonly serviceChoices = computed(() => this._session() !== this._scope || this._options() === null ? [] : _RoutineCreationChoices(this._options()!).services);
	/** Display projection of the server preview. */
	public readonly preview = computed(() => this._session() !== this._scope || this._preview() === null ? null : _RoutinePreviewView(this._preview()!));
	/** Whether a retained preview no longer matches the current schedule. */
	public readonly previewStale = computed(() => this._preview() !== null && this._previewSignature !== _ScheduleSignature(_RoutineScheduleFromDraft(this.draft())));
	/** Whether the reviewed form can be submitted. */
	public readonly canSubmit = computed(this._CanSubmit.bind(this));

	/** Cancels route-owned reads and commands when navigation destroys this editor. */
	public constructor() { this._destroyRef.onDestroy(this._Dispose.bind(this)); }

	/** Starts creation for a destination and loads its authorized choices. */
	public startCreate(destinationConversationId: string | null): void
	{
		this._ResetEditor();
		this._scope = this._session();
		this.mode.set(RoutineEditorModes.Create);
		this._destinationConversationId = destinationConversationId;
		if (destinationConversationId !== null && this._session() !== null)
			void this._LoadOptions(destinationConversationId);
	}

	/** Starts revision from the latest authorized detail projection. */
	public startRevision(detail: RoutineDetails): void
	{
		this._ResetEditor();
		this._scope = this._session();
		this.mode.set(RoutineEditorModes.Revise);
		this._revision = detail;
		this._draft.set(_RoutineRevisionDraft(detail));
	}

	/** Adopts fresh revision coordinates after a conflict without discarding the person's draft. */
	public acceptRefreshedRevision(detail: RoutineDetails): void
	{
		if (this._revision?.routineId !== detail.routineId || this._session() !== this._scope || this.commandState() !== RoutineCommandStates.Conflict)
			return;
		this._revision = detail;
		this.commandState.set(RoutineCommandStates.Idle);
		this.commandError.set(null);
		this._admission.release(RoutineCommandOwners.Editor);
	}

	/** Removes the route's decrypted draft and any retained retry command. */
	public clear(): void { this._ResetEditor(); }

	/** Retries creation choices for the current destination without accepting a typed identifier. */
	public retryOptions(): void
	{
		if (this._destinationConversationId !== null && this._session() === this._scope && this.optionsState() !== RoutineReadStates.Loading)
			void this._LoadOptions(this._destinationConversationId);
	}

	/** Replaces the schedule mode and clears retry state tied to the previous draft. */
	public setScheduleMode(value: RoutineDefinitionDraft["scheduleMode"]): void { this._Change({ ...this.draft(), scheduleMode: value }); }
	/** Replaces the local time and clears retry state tied to the previous draft. */
	public setLocalTime(value: string): void { this._Change({ ...this.draft(), localTime: value }); }
	/** Replaces the weekday and clears retry state tied to the previous draft. */
	public setWeekday(value: number): void { this._Change({ ...this.draft(), weekday: value }); }
	/** Replaces the advanced expression and clears retry state tied to the previous draft. */
	public setExpression(value: string): void { this._Change({ ...this.draft(), expression: value }); }
	/** Replaces the timezone and clears retry state tied to the previous draft. */
	public setTimezone(value: string): void { this._Change({ ...this.draft(), timezone: value }); }
	/** Replaces the instruction and clears retry state tied to the previous draft. */
	public setInstruction(value: string): void { this._Change({ ...this.draft(), instruction: value }); }
	/** Replaces the managed service and clears retry state tied to the previous draft. */
	public setManagedService(value: string): void { this._Change({ ...this.draft(), selectedManagedServiceId: value }); }

	/** Toggles one known non-self participant without allowing the requester to be removed. */
	public toggleAudience(participantRef: string): void
	{
		const choice = this.audienceChoices().find(candidate => candidate.participantRef === participantRef);
		if (choice === undefined || choice.isSelf || this.commandState() === RoutineCommandStates.Submitting)
			return;
		const selected = this.draft().audienceParticipantRefs;
		const audienceParticipantRefs = selected.includes(participantRef) ? selected.filter(reference => reference !== participantRef) : [...selected, participantRef];
		this._Change({ ...this.draft(), audienceParticipantRefs });
	}

	/** Requests the server's next five occurrences for the current schedule. */
	public async requestPreview(): Promise<void>
	{
		const session = this._session();
		const schedule = _RoutineScheduleFromDraft(this.draft());
		const requestedSignature = _ScheduleSignature(schedule);
		if (session === null || schedule === null || this.previewLoading() || this.commandState() !== RoutineCommandStates.Idle)
			return;
		this._readAbort?.abort();
		const abort = new AbortController();
		this._readAbort = abort;
		this.previewLoading.set(true);
		this.previewError.set(null);
		try
		{
			const preview = await this._gateway.preview(schedule, abort.signal);
			if (!this._Current(session, abort, this._readAbort))
				return;
			if (_ScheduleSignature(_RoutineScheduleFromDraft(this.draft())) !== requestedSignature)
				return;
			this._preview.set(preview);
			this._previewSignature = requestedSignature;
		}
		catch (error)
		{
			if (!this._Current(session, abort, this._readAbort) || _Aborted(error))
				return;
			if (_AccessLost(error))
				this._Purge();
			else
				this.previewError.set("The schedule could not be previewed. Check its expression and timezone, then try again.");
		}
		finally
		{
			if (this._readAbort === abort)
			{
				this._readAbort = null;
				if (this._session() === session)
					this.previewLoading.set(false);
			}
		}
	}

	/** Creates the reviewed routine or explicitly retries the saved unchanged command. */
	public async submitCreate(): Promise<{ readonly outcome: RoutineSubmitOutcomes; readonly routineId?: string; readonly definition?: RoutineDefinition }>
	{
		const session = this._session();
		const schedule = _RoutineScheduleFromDraft(this.draft());
		const destinationConversationId = this._destinationConversationId;
		const selectedManagedServiceId = this.draft().selectedManagedServiceId;
		if (session === null || schedule === null || destinationConversationId === null || selectedManagedServiceId === null || !this.canSubmit() || this.commandState() === RoutineCommandStates.Submitting)
			return { outcome: RoutineSubmitOutcomes.Rejected };
		const input = { destinationConversationId, audienceParticipantRefs: [...this.draft().audienceParticipantRefs], selectedManagedServiceId, schedule, instruction: this.draft().instruction.trim() };
		if (!this._admission.admit(RoutineCommandOwners.Editor))
			return { outcome: RoutineSubmitOutcomes.Rejected };
		const signature = JSON.stringify(input);
		const command = this._savedCreate?.signature === signature ? this._savedCreate.command : { ...input, idempotencyKey: crypto.randomUUID() };
		this._savedCreate = { signature, command };
		return await this._SubmitCreate(session, command);
	}

	/** Revises the current definition or explicitly retries the saved unchanged command. */
	public async submitRevision(): Promise<{ readonly outcome: RoutineSubmitOutcomes; readonly routineId?: string; readonly definition?: RoutineDefinition }>
	{
		const session = this._session();
		const schedule = _RoutineScheduleFromDraft(this.draft());
		const detail = this._revision;
		if (session === null || schedule === null || detail === null || !this.canSubmit() || this.commandState() === RoutineCommandStates.Submitting)
			return { outcome: RoutineSubmitOutcomes.Rejected };
		const input = { expectedRevision: detail.currentRevision, expectedLifecycleRevision: detail.lifecycleRevision, schedule, instruction: this.draft().instruction.trim() };
		if (!this._admission.admit(RoutineCommandOwners.Editor))
			return { outcome: RoutineSubmitOutcomes.Rejected };
		const signature = JSON.stringify(input);
		const command = this._savedRevise?.signature === signature ? this._savedRevise.command : { ...input, idempotencyKey: crypto.randomUUID() };
		this._savedRevise = { signature, command };
		return await this._SubmitRevision(session, detail.routineId, command);
	}

	/** Reads creation choices and starts with the requester selected exactly once. */
	private async _LoadOptions(destinationConversationId: string): Promise<void>
	{
		const session = this._session();
		if (session === null)
			return;
		const abort = new AbortController();
		this._readAbort = abort;
		this.optionsState.set(RoutineReadStates.Loading);
		this.optionsError.set(null);
		try
		{
			const options = await this._gateway.creationOptions(destinationConversationId, abort.signal);
			if (!this._Current(session, abort, this._readAbort) || this._destinationConversationId !== destinationConversationId)
				return;
			const self = options.audienceChoices.filter(choice => choice.isSelf);
			if (self.length !== 1)
				throw new RoutineGatewayError(RoutineGatewayErrorKinds.InvalidResponse);
			this._options.set(options);
			this._draft.set(_NewRoutineDraft(self[0]!.participantRef));
			this.optionsState.set(RoutineReadStates.Ready);
		}
		catch (error)
		{
			if (!this._Current(session, abort, this._readAbort) || _Aborted(error))
				return;
			if (_AccessLost(error))
			{
				this._Purge();
				this.optionsState.set(RoutineReadStates.AccessChanged);
			}
			else
			{
				this.optionsError.set("Creation choices are unavailable. Return to the chat and try again.");
				this.optionsState.set(RoutineReadStates.Unavailable);
			}
		}
		finally
		{
			if (this._readAbort === abort)
				this._readAbort = null;
		}
	}

	/** Sends the saved create command and classifies definite versus uncertain outcomes. */
	private async _SubmitCreate(session: string, command: RoutineCreateCommand): Promise<{ readonly outcome: RoutineSubmitOutcomes; readonly routineId?: string; readonly definition?: RoutineDefinition }>
	{
		const abort = this._BeginCommand();
		try
		{
			const result = await this._gateway.create(command, abort.signal);
			if (!this._Current(session, abort, this._commandAbort))
				return { outcome: RoutineSubmitOutcomes.AccessChanged };
			this._savedCreate = null;
			this._admission.release(RoutineCommandOwners.Editor);
			this.commandState.set(RoutineCommandStates.Idle);
			return { outcome: RoutineSubmitOutcomes.Committed, routineId: result.routineId, definition: result };
		}
		catch (error)
		{
			return this._CommandFailed(error, session, abort);
		}
		finally
		{
			if (this._commandAbort === abort)
				this._commandAbort = null;
		}
	}

	/** Sends the saved revise command and classifies definite versus uncertain outcomes. */
	private async _SubmitRevision(session: string, routineId: string, command: RoutineReviseCommand): Promise<{ readonly outcome: RoutineSubmitOutcomes; readonly routineId?: string; readonly definition?: RoutineDefinition }>
	{
		const abort = this._BeginCommand();
		try
		{
			const result = await this._gateway.revise(routineId, command, abort.signal);
			if (!this._Current(session, abort, this._commandAbort))
				return { outcome: RoutineSubmitOutcomes.AccessChanged };
			this._savedRevise = null;
			this._admission.release(RoutineCommandOwners.Editor);
			this.commandState.set(RoutineCommandStates.Idle);
			return { outcome: RoutineSubmitOutcomes.Committed, routineId: result.routineId, definition: result };
		}
		catch (error)
		{
			return this._CommandFailed(error, session, abort);
		}
		finally
		{
			if (this._commandAbort === abort)
				this._commandAbort = null;
		}
	}

	/** Begins one mutation before its first await and blocks conflicting commands. */
	private _BeginCommand(): AbortController
	{
		const abort = new AbortController();
		this._commandAbort = abort;
		this.commandState.set(RoutineCommandStates.Submitting);
		this.commandError.set(null);
		return abort;
	}

	/** Converts a mutation failure into a retry, conflict, denial or definite rejection. */
	private _CommandFailed(error: unknown, session: string, abort: AbortController): { readonly outcome: RoutineSubmitOutcomes }
	{
		if (!this._Current(session, abort, this._commandAbort) || _Aborted(error))
			return { outcome: RoutineSubmitOutcomes.AccessChanged };
		if (_AccessLost(error))
		{
			this._admission.release(RoutineCommandOwners.Editor);
			this._Purge();
			return { outcome: RoutineSubmitOutcomes.AccessChanged };
		}
		if (error instanceof RoutineGatewayError && error.kind === RoutineGatewayErrorKinds.Conflict)
		{
			this._savedCreate = null;
			this._savedRevise = null;
			this.commandState.set(RoutineCommandStates.Conflict);
			this.commandError.set("The routine changed elsewhere. Refresh its details before trying again.");
			return { outcome: RoutineSubmitOutcomes.Conflict };
		}
		if (error instanceof RoutineGatewayError && (error.kind === RoutineGatewayErrorKinds.Unavailable || error.kind === RoutineGatewayErrorKinds.Unknown || error.kind === RoutineGatewayErrorKinds.InvalidResponse))
		{
			this.commandState.set(RoutineCommandStates.Uncertain);
			this.commandError.set("OpenCrane could not confirm the result. Retry this unchanged form to reuse the same request.");
			return { outcome: RoutineSubmitOutcomes.Uncertain };
		}
		this._savedCreate = null;
		this._savedRevise = null;
		this._admission.release(RoutineCommandOwners.Editor);
		this.commandState.set(RoutineCommandStates.Idle);
		this.commandError.set("The routine could not be saved. Review the form and try again.");
		return { outcome: RoutineSubmitOutcomes.Rejected };
	}

	/** Applies a user edit and invalidates command state tied to the earlier values. */
	private _Change(draft: RoutineDefinitionDraft): void
	{
		if (this.commandState() === RoutineCommandStates.Submitting || this.commandState() === RoutineCommandStates.Uncertain || this.commandState() === RoutineCommandStates.Conflict)
			return;
		this._readAbort?.abort();
		this._readAbort = null;
		this.previewLoading.set(false);
		this._preview.set(null);
		this._previewSignature = null;
		this._draft.set(draft);
		this.commandState.set(RoutineCommandStates.Idle);
		this.commandError.set(null);
	}

	/** Checks required choices and a matching server preview without granting command authority. */
	private _CanSubmit(): boolean
	{
		const schedule = _RoutineScheduleFromDraft(this.draft());
		if (this.commandState() === RoutineCommandStates.Conflict || schedule === null || this.draft().instruction.trim().length === 0 || this._previewSignature !== _ScheduleSignature(schedule))
			return false;
		if (this.mode() === RoutineEditorModes.Revise)
			return this._revision !== null;
		const choices = this.audienceChoices();
		const selected = this.draft().audienceParticipantRefs;
		const self = choices.filter(choice => choice.isSelf && selected.includes(choice.participantRef));
		return this._destinationConversationId !== null && self.length === 1 && selected.every(reference => choices.some(choice => choice.participantRef === reference)) && this.serviceChoices().some(choice => choice.id === this.draft().selectedManagedServiceId);
	}

	/** Rejects responses from an aborted request or superseded session. */
	private _Current(session: string, abort: AbortController, owner: AbortController | null): boolean
	{
		return this._session() === session && this._scope === session && owner === abort && !abort.signal.aborted;
	}

	/** Removes every protected form value when session identity changes. */
	private _SessionChanged(): void
	{
		const session = this._session();
		if (session === this._scope)
			return;
		this._Purge();
		this._scope = session;
	}

	/** Clears the current editor while retaining no protected options or decrypted instruction. */
	private _ResetEditor(): void
	{
		this._readAbort?.abort();
		this._commandAbort?.abort();
		this._readAbort = null;
		this._commandAbort = null;
		this._options.set(null);
		this._preview.set(null);
		this._previewSignature = null;
		this._revision = null;
		this._destinationConversationId = null;
		this._savedCreate = null;
		this._savedRevise = null;
		this._admission.release(RoutineCommandOwners.Editor);
		this._draft.set(_NewRoutineDraft(null));
		this.optionsState.set(RoutineReadStates.Idle);
		this.optionsError.set(null);
		this.previewLoading.set(false);
		this.previewError.set(null);
		this.commandState.set(RoutineCommandStates.Idle);
		this.commandError.set(null);
	}

	/** Clears the editor after access or session loss. */
	private _Purge(): void { this._ResetEditor(); }

	/** Cancels route-owned work without interpreting whether the server committed a request. */
	private _Dispose(): void { this._readAbort?.abort(); this._commandAbort?.abort(); this._readAbort = null; this._commandAbort = null; this._admission.release(RoutineCommandOwners.Editor); }
}

/** Serializes a normalized schedule for preview-to-command matching. */
function _ScheduleSignature(schedule: RoutineSchedule | null): string | null { return schedule === null ? null : JSON.stringify(schedule); }

/** Identifies cancellation without treating it as an API failure. */
function _Aborted(error: unknown): boolean { return error instanceof DOMException && error.name === "AbortError"; }

/** Identifies current-session failures that require protected state removal. */
function _AccessLost(error: unknown): boolean
{
	return error instanceof RoutineGatewayError && (error.kind === RoutineGatewayErrorKinds.Unauthenticated || error.kind === RoutineGatewayErrorKinds.AccessDenied || error.kind === RoutineGatewayErrorKinds.NotFound);
}
