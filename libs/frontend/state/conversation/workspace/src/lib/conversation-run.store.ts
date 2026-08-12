import { Injectable, computed, inject, signal } from "@angular/core";

import { CONVERSATION_WORKSPACE_GATEWAY } from "./conversation-workspace.gateway.js";
import { ConversationWorkspaceGatewayError } from "./conversation-workspace-gateway.errors.js";
import { ConversationRunStates, type ConversationRun } from "./conversation-workspace.types.js";

/** Component-scoped run status, steering, cancellation, and retry state. */
@Injectable()
export class ConversationRunStore
{
	/** Participant-scoped generated-client port. */
	private readonly _gateway = inject(CONVERSATION_WORKSPACE_GATEWAY);
	/** Current run projection. */
	private readonly _run = signal<ConversationRun | null>(null);
	/** Controlled steering draft. */
	private readonly _steeringDraft = signal("");
	/** Whether a run command is active. */
	private readonly _busy = signal(false);
	/** Browser-safe run command error. */
	private readonly _error = signal<string | null>(null);
	/** Last run and streamed lifecycle coordinate whose status read started. */
	private _requestedObservation: string | null = null;

	/** Public current run projection. */
	public readonly run = this._run.asReadonly();
	/** Public controlled steering draft. */
	public readonly steeringDraft = this._steeringDraft.asReadonly();
	/** Public command state. */
	public readonly busy = this._busy.asReadonly();
	/** Public browser-safe error. */
	public readonly error = this._error.asReadonly();
	/** Whether the current run accepts an explicit steering instruction. */
	public readonly canSteer = computed(this._CanSteer.bind(this));
	/** Whether the current run accepts a cancellation request. */
	public readonly canCancel = computed(this._CanCancel.bind(this));
	/** Whether the current run can start a new attempt. */
	public readonly canRetry = computed(this._CanRetry.bind(this));

	/** Refresh status whenever the stream advances this run to a different lifecycle. */
	public async observe(runId: string, conversationId: string, streamLifecycle: string): Promise<void>
	{
		const observation = `${runId}:${streamLifecycle}`;
		if (observation === this._requestedObservation) return;
		this._requestedObservation = observation;
		try
		{
			const run = await this._gateway.run(runId);
			if (observation === this._requestedObservation && run.conversationId === conversationId) this._run.set(run);
		}
		catch (error)
		{
			if (observation !== this._requestedObservation) return;
			this._requestedObservation = null;
			this._error.set(_Message(error, "OpenCrane could not load run status."));
		}
	}

	/** Keep the steering control separate from ordinary participant input. */
	public updateSteeringDraft(value: string): void { this._steeringDraft.set(value); }

	/** Queue the exact steering draft for the selected live run. */
	public async steer(): Promise<void>
	{
		const run = this._run();
		const text = this._steeringDraft().trim();
		if (run === null || text.length === 0 || !this._CanSteer()) return;
		this._busy.set(true);
		try { await this._gateway.steer(run.runId, text); this._steeringDraft.set(""); }
		catch (error) { this._error.set(_Message(error, "OpenCrane could not steer this run.")); }
		finally { this._busy.set(false); }
	}

	/** Cancel the exact attempt visible in the selected run projection. */
	public async cancel(): Promise<void>
	{
		const run = this._run();
		if (run === null || !this._CanCancel()) return;
		this._busy.set(true);
		try { this._run.set(await this._gateway.cancel(run.runId, run.attempt)); }
		catch (error) { this._error.set(_Message(error, "OpenCrane could not cancel this run.")); }
		finally { this._busy.set(false); }
	}

	/** Start one fresh attempt for the exact visible failed run. */
	public async retry(conversationId: string): Promise<void>
	{
		const run = this._run();
		if (run === null || !this._CanRetry()) return;
		this._busy.set(true);
		try { this._run.set(await this._gateway.retry({ conversationId, runId: run.runId, expectedAttempt: run.attempt, idempotencyKey: globalThis.crypto.randomUUID() })); }
		catch (error) { this._error.set(_Message(error, "OpenCrane could not retry this run.")); }
		finally { this._busy.set(false); }
	}

	/** Drop all selected run state after route change or access loss. */
	public clear(): void
	{
		this._requestedObservation = null;
		this._run.set(null);
		this._steeringDraft.set("");
		this._error.set(null);
	}

	/** Whether the current run is at a safe steering boundary. */
	private _CanSteer(): boolean
	{
		const state = this._run()?.state;
		return !this._busy() && this._steeringDraft().trim().length > 0 && (state === ConversationRunStates.Queued || state === ConversationRunStates.Assigned || state === ConversationRunStates.Running);
	}

	/** Whether the current run may accept exact-attempt cancellation. */
	private _CanCancel(): boolean
	{
		const state = this._run()?.state;
		return !this._busy() && state !== undefined && state !== ConversationRunStates.Completed && state !== ConversationRunStates.Failed && state !== ConversationRunStates.Cancelled;
	}

	/** Whether the current run is failed rather than in ambiguous recovery. */
	private _CanRetry(): boolean { return !this._busy() && this._run()?.state === ConversationRunStates.Failed; }
}

/** Reduce an unknown failure to safe existing gateway copy or a fixed fallback. */
function _Message(error: unknown, fallback: string): string
{
	return error instanceof ConversationWorkspaceGatewayError ? error.message : fallback;
}
