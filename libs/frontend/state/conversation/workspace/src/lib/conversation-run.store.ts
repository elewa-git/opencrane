import { Injectable, computed, inject, signal } from "@angular/core";

import { CONVERSATION_WORKSPACE_GATEWAY } from "./conversation-workspace.gateway.js";
import { ConversationWorkspaceGatewayError } from "./conversation-workspace-gateway.errors.js";
import { ConversationRunStates, type ConversationRun, type SubmitConversationSteeringCommand } from "./conversation-workspace.types.js";

/**
 * Holds the status of the one agent run the participant is currently looking at, and runs the three
 * commands they can aim at it: steer, cancel, and retry.
 *
 * The AG-UI stream tells the workspace which run is live and roughly where it is, but it does not
 * carry the authoritative run row. So this store re-reads run status from the API whenever the
 * stream says the lifecycle moved, and every command adopts the projection the server returns rather
 * than guessing the next state locally.
 *
 * Lifetime: this is `@Injectable()` with no `providedIn`, and it is listed in the `providers` of
 * `ConversationWorkspacePageComponent`. So there is one instance per mounted workspace page, shared
 * with `ConversationWorkspaceStore` (which injects it as `runs`), and Angular destroys it when the
 * route leaves. None of this state survives navigation, which is why nothing here has to be reset on
 * the way out — {@link clear} exists for switching conversations inside the same page.
 *
 * Called by: `ConversationWorkspaceStore` (`observe` from the stream update handler, `clear` when a
 * selection is dropped or access is purged) and `ConversationWorkspacePageComponent`'s template,
 * which binds the run-actions component straight to `steer`, `cancel`, `retry`, and
 * `updateSteeringDraft`.
 */
@Injectable()
export class ConversationRunStore
{
	/** The signed-in participant's workspace API port. Every read and command goes through it. */
	private readonly _gateway = inject(CONVERSATION_WORKSPACE_GATEWAY);
	/** The run the participant is looking at, or null when no run is selected or access was purged. */
	private readonly _run = signal<ConversationRun | null>(null);
	/** Text typed into the steering box. Kept apart from the ordinary message draft on purpose. */
	private readonly _steeringDraft = signal("");
	/** True while one of steer, cancel, or retry is in flight. Blocks the other two as well. */
	private readonly _busy = signal(false);
	/** Copy for the last failed run command, already safe to display. Null when nothing failed. */
	private readonly _error = signal<string | null>(null);
	/**
	 * The steering command that was already sent but never confirmed, kept so a second attempt resends
	 * the identical idempotency key instead of queueing the instruction a second time.
	 */
	private _pendingSteering: SubmitConversationSteeringCommand | null = null;
	/**
	 * The `runId:streamLifecycle` pair whose status read is in flight or already done. It is what makes
	 * {@link observe} read once per lifecycle change, and what lets it drop a response that arrives
	 * after a newer read started.
	 */
	private _requestedObservation: string | null = null;

	/** The run on screen, for the presenter to map into labels and action visibility. */
	public readonly run = this._run.asReadonly();
	/** The steering text to render in the input, so the control stays server-independent. */
	public readonly steeringDraft = this._steeringDraft.asReadonly();
	/** Whether a run command is in flight, used to disable all three run actions at once. */
	public readonly busy = this._busy.asReadonly();
	/** The last run-command failure message to show, or null. */
	public readonly error = this._error.asReadonly();
	/** True when the run is still doing work and there is text to send, so Steer may be offered. */
	public readonly canSteer = computed(this._CanSteer.bind(this));
	/** True when the run has not finished yet, so Cancel may be offered. */
	public readonly canCancel = computed(this._CanCancel.bind(this));
	/** True only for a failed run, so Retry is never offered where a new attempt is unsafe. */
	public readonly canRetry = computed(this._CanRetry.bind(this));

	/**
	 * Re-reads run status when the AG-UI stream reports this run at a lifecycle it has not been read
	 * at yet.
	 *
	 * Every stream frame calls this, so comparing the `runId:streamLifecycle` pair is what keeps it from
	 * issuing a request per frame: the same pair is ignored, a changed lifecycle reads again. A read
	 * that fails forgets the pair, so the very next frame for the same lifecycle retries it rather
	 * than leaving the status stuck at the previous value.
	 *
	 * Called by: `ConversationWorkspaceStore._AdoptStreamUpdate`, with the selected conversation's id
	 * and `update.state.runStatus` (an `AgUiRunStatuses` value).
	 *
	 * @param runId - The run named by the live stream.
	 * @param conversationId - The conversation the participant has selected. The response is only
	 *   adopted if it names this same conversation, so a run belonging to another conversation cannot
	 *   paint status onto the open one.
	 * @param streamLifecycle - The stream's current view of the run lifecycle. Only used to decide
	 *   whether to read again; the state that gets displayed always comes from the API response.
	 * @returns Resolves once the read settles. It never throws: a failure lands in {@link error} and
	 *   leaves the previous run projection on screen.
	 */
	public async observe(runId: string, conversationId: string, streamLifecycle: string): Promise<void>
	{
		// 1. Read once per run-and-lifecycle pair, because the stream calls this on every frame.
		const observation = `${runId}:${streamLifecycle}`;
		if (observation === this._requestedObservation) return;
		this._requestedObservation = observation;
		try
		{
			// 2. Take the authoritative status from the API; the stream only said something changed.
			const run = await this._gateway.run(runId);
			// 3. Adopt it only while this is still the newest read and it names the selected
			//    conversation, so a response overtaken by a newer one is dropped instead of applied.
			if (observation === this._requestedObservation && run.conversationId === conversationId) this._run.set(run);
		}
		catch (error)
		{
			// 4. Report only the newest read's failure, and forget the pair so the next frame retries.
			if (observation !== this._requestedObservation) return;
			this._requestedObservation = null;
			this._error.set(_Message(error, "OpenCrane could not load run status."));
		}
	}

	/**
	 * Stores what the participant typed into the steering box. Nothing is sent.
	 *
	 * Steering is a separate instruction to a working agent, not a message in the conversation, so it
	 * has its own draft and never touches the composer draft held by `ConversationWorkspaceStore`.
	 *
	 * Called by: the run-actions component's `steeringDraftChange` output, bound in
	 * `conversation-workspace-page.component.html`.
	 *
	 * @param value - Current text in the steering input.
	 */
	public updateSteeringDraft(value: string): void { this._steeringDraft.set(value); }

	/**
	 * Sends the steering text to the run that is currently working.
	 *
	 * Does nothing, and reports nothing, when no run is selected, the text is blank, another command
	 * is in flight, or the run is past the point where steering is accepted — see {@link canSteer}.
	 *
	 * A failed send keeps both the text and the command's idempotency key, so pressing Steer again
	 * resends the identical command and the server can recognise it as the same instruction instead of
	 * queueing it twice. The draft is only cleared once the server accepts.
	 *
	 * Called by: the run-actions component's `steerRequested` output.
	 *
	 * @returns Resolves when the send settles. Failures are put in {@link error}, not thrown.
	 */
	public async steer(): Promise<void>
	{
		const run = this._run();
		const text = this._steeringDraft().trim();
		if (run === null || text.length === 0 || !this._CanSteer()) return;
		const command = this._PendingSteeringCommand(run.runId, text);
		this._busy.set(true);
		try { await this._gateway.steer(command); this._pendingSteering = null; this._steeringDraft.set(""); }
		catch (error) { this._error.set(_Message(error, "OpenCrane could not steer this run.")); }
		finally { this._busy.set(false); }
	}

	/**
	 * Asks the server to cancel the attempt the participant can currently see.
	 *
	 * The request carries `run.attempt`, so if the run has already moved to another attempt the server
	 * refuses with 409 and the gateway raises `Conflict` — cancelling never lands on an attempt the
	 * participant did not look at. On success the returned projection is adopted as-is, which is how
	 * the difference between `Cancelling` (stopped, cleanup still owed) and `Cancelled` reaches the UI.
	 *
	 * Called by: the run-actions component's `cancelRequested` output.
	 *
	 * @returns Resolves when the request settles. Failures are put in {@link error}, not thrown, and
	 *   the run stays on its previous state so the participant can try again.
	 */
	public async cancel(): Promise<void>
	{
		const run = this._run();
		if (run === null || !this._CanCancel()) return;
		this._busy.set(true);
		try { this._run.set(await this._gateway.cancel(run.runId, run.attempt)); }
		catch (error) { this._error.set(_Message(error, "OpenCrane could not cancel this run.")); }
		finally { this._busy.set(false); }
	}

	/**
	 * Starts a new attempt of the failed run the participant can see.
	 *
	 * Only a `Failed` run qualifies — see {@link canRetry} — so a run in `RecoveryRequired`, where an
	 * external action's outcome is unknown, is never retried from here.
	 *
	 * The command carries the observed `attempt` and a fresh idempotency key. The fresh key is safe
	 * because the attempt is what guards the start: if the run has already advanced to another attempt
	 * the server answers 409 and the gateway raises `Conflict`, instead of starting a second run. A
	 * refused retry leaves the run visible as failed so the participant can read the error and decide.
	 *
	 * Called by: the run-actions component's `retryRequested` output, which passes the selected
	 * conversation's id.
	 *
	 * @param conversationId - The conversation that owns the run. It is passed in rather than read from
	 *   `run.conversationId`, because a projection returned by a cancel command carries no
	 *   conversation id.
	 * @returns Resolves when the request settles. Failures are put in {@link error}, not thrown.
	 */
	public async retry(conversationId: string): Promise<void>
	{
		const run = this._run();
		if (run === null || !this._CanRetry()) return;
		this._busy.set(true);
		try { this._run.set(await this._gateway.retry({ conversationId, runId: run.runId, expectedAttempt: run.attempt, idempotencyKey: globalThis.crypto.randomUUID() })); }
		catch (error) { this._error.set(_Message(error, "OpenCrane could not retry this run.")); }
		finally { this._busy.set(false); }
	}

	/**
	 * Forgets the run entirely: its projection, the steering text, the unconfirmed steering command,
	 * and the record of what has been read.
	 *
	 * Call this whenever the page stops being about this run — another conversation is selected, or the
	 * participant lost access to the open one. Forgetting what has been read matters as much as dropping the
	 * run: reopening the same conversation would otherwise find its run and lifecycle already marked as
	 * read, and the status would stay empty until the stream reported a different lifecycle.
	 *
	 * `busy` is deliberately left alone; a command still in flight owns it and clears it in its own
	 * `finally`.
	 *
	 * Called by: `ConversationWorkspaceStore._PurgeAccess` (after access was withdrawn) and
	 * `ConversationWorkspaceStore._ClearSelection` (when a selection is dropped).
	 */
	public clear(): void
	{
		this._requestedObservation = null;
		this._run.set(null);
		this._steeringDraft.set("");
		this._pendingSteering = null;
		this._error.set(null);
	}

	/**
	 * Decides whether Steer can be offered: the run has to still be doing work, no other run command
	 * may be in flight, and there has to be text to send.
	 *
	 * `Queued`, `Assigned`, and `Running` are the states where a new instruction can still reach the
	 * agent. Every other state is either waiting on the participant, needing recovery, or over.
	 */
	private _CanSteer(): boolean
	{
		const state = this._run()?.state;
		return !this._busy() && this._steeringDraft().trim().length > 0 && (state === ConversationRunStates.Queued || state === ConversationRunStates.Assigned || state === ConversationRunStates.Running);
	}

	/**
	 * Decides whether Cancel can be offered: anything except a run that has already finished.
	 *
	 * Written as "not one of the three end states" rather than a list of allowed ones, so a run in
	 * `WaitingForInput` or `RecoveryRequired` can still be stopped. The run-store test pins that:
	 * `RecoveryRequired` may be cancelled while `Cancelled` may not.
	 */
	private _CanCancel(): boolean
	{
		const state = this._run()?.state;
		return !this._busy() && state !== undefined && state !== ConversationRunStates.Completed && state !== ConversationRunStates.Failed && state !== ConversationRunStates.Cancelled;
	}

	/**
	 * Decides whether Retry can be offered: only a `Failed` run, and only while no command is running.
	 *
	 * `RecoveryRequired` is excluded on purpose. That state means an external action's outcome is
	 * unknown, so a new attempt could repeat work that already happened; the run-store test asserts no
	 * retry is offered for it, and none is sent even if something calls {@link retry} anyway.
	 */
	private _CanRetry(): boolean { return !this._busy() && this._run()?.state === ConversationRunStates.Failed; }

	/**
	 * Returns the steering command to send: the one still awaiting confirmation for this run, or a new
	 * one with a fresh idempotency key.
	 *
	 * A steering send can fail after the server already accepted it — a connection dropped after the
	 * commit looks the same from here as one that never arrived. Reusing the stored command means the
	 * second attempt carries the same idempotency key, so the server can tell it is the same
	 * instruction rather than a second one. The store's test asserts both sends carry an identical
	 * command.
	 *
	 * @param runId - The run being steered. A stored command for a different run is discarded, because
	 *   its key belongs to that run's queue.
	 * @param text - Text for a new command. It is ignored when a stored command is reused, so a
	 *   resend repeats the instruction that was already sent.
	 */
	private _PendingSteeringCommand(runId: string, text: string): SubmitConversationSteeringCommand
	{
		if (this._pendingSteering !== null && this._pendingSteering.runId === runId) return this._pendingSteering;
		const command = { runId, text, idempotencyKey: globalThis.crypto.randomUUID() };
		this._pendingSteering = command;
		return command;
	}
}

/**
 * Picks the message to show for a failed run command.
 *
 * A `ConversationWorkspaceGatewayError` already carries copy written for a participant, so it is used
 * as it stands. Anything else is an unexpected error whose text may contain internals, so the caller's
 * own wording is shown instead.
 *
 * @param error - Whatever the command threw.
 * @param fallback - Copy to show when the error did not come from the workspace gateway.
 * @returns A string safe to render.
 */
function _Message(error: unknown, fallback: string): string
{
	return error instanceof ConversationWorkspaceGatewayError ? error.message : fallback;
}
