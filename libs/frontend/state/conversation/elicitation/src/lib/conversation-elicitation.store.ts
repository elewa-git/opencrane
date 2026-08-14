import { Injectable, computed, inject, signal } from "@angular/core";

import { ElicitationRequestStates, type ConversationElicitation, type ElicitationResponseValue } from "@opencrane/contracts";

import { ElicitationGatewayError, ElicitationGatewayErrorKinds } from "./elicitation-gateway.errors.js";
import { ELICITATION_GATEWAY } from "./opencrane-conversation-elicitation.gateway.js";

/**
 * Holds the one question or approval an agent run is currently waiting on, and the answer the
 * participant is putting together for it.
 *
 * The server owns whether the request is still open and what its answer became; this store keeps only
 * the local half — the selection not yet submitted, whether a submission is running, and where to send
 * the participant if the answer needs a fresh sign-in first. Nothing here predicts the outcome: after a
 * submit, only the server's returned state is adopted.
 *
 * Lifetime: `@Injectable()` with no `providedIn`, listed in the `providers` of
 * `ConversationWorkspacePageComponent`, so there is one instance per mounted workspace page and none of
 * this survives navigation. {@link clear} is for switching conversations inside the same page.
 *
 * Called by: `ConversationWorkspacePresenter` (`clear` and `load` from its selection effect, `select`
 * and `submit` from the elicitation card's outputs).
 */
@Injectable()
export class ConversationElicitationStore
{
	/** The signed-in participant's elicitation API port: read the request, send the response. */
	private readonly _gateway = inject(ELICITATION_GATEWAY);
	/** The request as the server last described it, or null when there is none to answer. */
	private readonly _elicitation = signal<ConversationElicitation | null>(null);
	/**
	 * What the participant has chosen but not sent. Kept across a step-up sign-in, so returning from
	 * reauthentication does not make them type the answer again.
	 */
	private readonly _draft = signal<ElicitationResponseValue | null>(null);
	/** True while a submission is in flight. Blocks a second submission of the same answer. */
	private readonly _busy = signal(false);
	/** Message for the last failed load or submit, already safe to display. Null when nothing failed. */
	private readonly _error = signal<string | null>(null);
	/** Where to send the participant to sign in again, when the server demanded step-up for this answer. Null when no step-up is pending. */
	private readonly _stepUpPath = signal<string | null>(null);
	/** The request whose control should take focus back once the page returns from step-up. */
	private readonly _restoreFocusRequestId = signal<string | null>(null);
	/**
	 * Counts loads and clears. A command captures it before it starts and compares afterwards, so a
	 * response for a request that is no longer on screen is dropped instead of applied.
	 */
	private _generation = 0;

	/** The request on screen, for the card to render its question and its state. */
	public readonly elicitation = this._elicitation.asReadonly();
	/** The chosen answer, or null when nothing is chosen yet. Never means "submitted". */
	public readonly draft = this._draft.asReadonly();
	/** Whether a submission is in flight, so the card can disable its submit control. */
	public readonly busy = this._busy.asReadonly();
	/** The last load or submit failure message to show, or null. */
	public readonly error = this._error.asReadonly();
	/** Set only while a step-up sign-in is owed before the answer can be accepted. */
	public readonly stepUpPath = this._stepUpPath.asReadonly();
	/** Set only while focus still has to be restored after coming back from step-up. */
	public readonly restoreFocusRequestId = this._restoreFocusRequestId.asReadonly();
	/** True when an answer is chosen, nothing is in flight, and the request is still open. */
	public readonly canSubmit = computed(this._CanSubmit.bind(this));

	/**
	 * Reads one request from the server and shows it.
	 *
	 * The draft is only thrown away when the request that comes back is a different one. That is what
	 * makes this safe to call repeatedly — the selection effect calls it on every stream update, and
	 * re-reading the same request must not wipe an answer the participant is in the middle of choosing.
	 * The generation captured at the start means a slow read that has been overtaken is discarded.
	 *
	 * Called by: `ConversationWorkspacePresenter._OpenComposedState`, with the first pending interrupt
	 * from the live stream, and {@link recoverAfterStepUp}.
	 *
	 * @param conversationId - The conversation the request belongs to.
	 * @param requestId - The request to read.
	 * @returns Resolves when the read settles. It never throws: a failure lands in {@link error} and
	 *   leaves whatever was on screen in place.
	 */
	public async load(conversationId: string, requestId: string): Promise<void>
	{
		const generation = ++this._generation;
		this._error.set(null);
		try
		{
			const elicitation = await this._gateway.read(conversationId, requestId);
			if (generation !== this._generation) return;
			if (this._elicitation()?.requestId !== elicitation.requestId) this._draft.set(null);
			this._elicitation.set(elicitation);
		}
		catch { if (generation === this._generation) this._error.set("OpenCrane could not load this question."); }
	}

	/**
	 * Stores what the participant chose. Nothing is sent.
	 *
	 * The choice is ignored unless the request is still in `Requested` state and the answer's kind
	 * matches the kind the request asked for — so an answer cannot be recorded against a question that
	 * was already resolved, or against a differently-shaped one after the request changed underneath.
	 *
	 * Called by: `ConversationWorkspacePresenter.selectElicitation`, from the elicitation card's output.
	 *
	 * @param response - The chosen answer, in the shape the request's body asked for.
	 */
	public select(response: ElicitationResponseValue): void
	{
		const elicitation = this._elicitation();
		if (elicitation === null || elicitation.state !== ElicitationRequestStates.Requested || response.kind !== elicitation.body.kind) return;
		this._draft.set(response);
		this._error.set(null);
	}

	/**
	 * Sends the chosen answer and takes the server's word for what it became.
	 *
	 * Does nothing when there is no answer, one is already in flight, or the request is no longer open.
	 * Two failures are handled differently. A step-up demand is not really a failure: the answer is kept,
	 * {@link stepUpPath} is set so the page can send the participant to sign in again, and
	 * {@link restoreFocusRequestId} records where focus belongs on the way back. Any other failure is
	 * followed by a re-read, because a send that failed after the server had already accepted it looks
	 * identical from here — the re-read is what settles which happened.
	 *
	 * Called by: `ConversationWorkspacePresenter.submitElicitation`, from the card's submit output.
	 *
	 * @returns True only when the server accepted this answer and its resolved state was adopted. False
	 *   for every other outcome — refused, step-up owed, failed, or overtaken by a newer request — so a
	 *   caller must not treat false as "the question is still open" without reading
	 *   {@link elicitation} and {@link stepUpPath}.
	 */
	public async submit(): Promise<boolean>
	{
		// 1. Refuse unless there is an answer to send and the request is still open.
		const elicitation = this._elicitation();
		const draft = this._draft();
		if (elicitation === null || draft === null || !this._CanSubmit()) return false;
		const generation = this._generation;
		this._busy.set(true);
		this._error.set(null);
		try
		{
			// 2. Send the answer with a fresh idempotency key, so the server can recognise a duplicate.
			const projection = await this._gateway.respond(elicitation.conversationId, elicitation.requestId, { idempotencyKey: globalThis.crypto.randomUUID(), response: draft });
			// 3. Drop the result if the store moved on, or if it answers a different request.
			if (generation !== this._generation || projection.requestId !== this._elicitation()?.requestId) return false;
			// 4. Take the server's resolved state and time, then let the answer and any step-up go.
			this._elicitation.update(function _Terminal(current) { return current === null ? null : { ...current, state: projection.state, resolvedAt: projection.resolvedAt }; });
			this._draft.set(null);
			this._stepUpPath.set(null);
			return true;
		}
		catch (error)
		{
			if (generation !== this._generation) return false;
			// 5. A step-up demand keeps the answer and points the page at reauthentication instead.
			if (error instanceof ElicitationGatewayError && error.kind === ElicitationGatewayErrorKinds.StepUpRequired)
			{
				this._stepUpPath.set(error.reauthenticatePath);
				this._restoreFocusRequestId.set(elicitation.requestId);
				this._error.set(error.message);
				return false;
			}
			// 6. Any other failure may still have been applied, so re-read and show what the server has.
			this._error.set(error instanceof Error ? error.message : "OpenCrane could not save this response.");
			await this._Reconcile(elicitation, generation);
			return false;
		}
		finally { if (generation === this._generation) this._busy.set(false); }
	}

	/**
	 * Picks the request back up after the participant has signed in again.
	 *
	 * Clears the step-up path first, then re-reads the same request. Because {@link load} only drops the
	 * draft when the request's identity changed, the answer chosen before the sign-in is still there and
	 * {@link restoreFocusRequestId} still says where focus goes — so the participant only has to submit.
	 *
	 * Called by: `ConversationWorkspacePageComponent.recoverAfterStepUp`, which the app's chats route
	 * component calls once its verified sign-in window closes.
	 *
	 * @returns Resolves once the re-read settles. Does nothing when no request is on screen.
	 */
	public async recoverAfterStepUp(): Promise<void>
	{
		const current = this._elicitation();
		if (current === null) return;
		this._stepUpPath.set(null);
		await this.load(current.conversationId, current.requestId);
	}

	/**
	 * Says that focus has been put back, so it is not moved again on the next render.
	 *
	 * Called by: `ConversationWorkspacePageComponent._RestoreElicitationFocus`, after it has scrolled the
	 * request into view and focused it.
	 */
	public acknowledgeFocusRestored(): void { this._restoreFocusRequestId.set(null); }

	/**
	 * Forgets the request, the answer being composed, and any step-up owed for it.
	 *
	 * Call this when the page stops being about this conversation — another one is selected, or the
	 * participant lost access to the open one. It matters more here than in most stores because the draft
	 * is something the participant typed or chose in private and must not be carried into a different
	 * conversation. Bumping the generation first means a read or submit still in flight finds itself stale
	 * and writes nothing back, and `busy` is reset directly for the same reason: the in-flight command
	 * will decline to clear it.
	 *
	 * Called by: `ConversationWorkspacePresenter._OpenComposedState`, both when the selection is dropped
	 * and just before opening a different conversation.
	 */
	public clear(): void
	{
		this._generation += 1;
		this._elicitation.set(null);
		this._draft.set(null);
		this._busy.set(false);
		this._error.set(null);
		this._stepUpPath.set(null);
		this._restoreFocusRequestId.set(null);
	}

	/**
	 * Decides whether the answer can be sent: nothing in flight, an answer chosen, and the request still
	 * in `Requested` state — so a question the server has already resolved cannot be answered again.
	 */
	private _CanSubmit(): boolean { return !this._busy() && this._draft() !== null && this._elicitation()?.state === ElicitationRequestStates.Requested; }

	/**
	 * Re-reads the request after a submit failed, to find out whether it landed anyway.
	 *
	 * A dropped connection after the server committed the response looks exactly like one before it, so
	 * the server's own copy is the only way to tell. If this read also fails, the state is left as it was
	 * and the submit error stays on screen for the participant to retry.
	 */
	private async _Reconcile(elicitation: ConversationElicitation, generation: number): Promise<void>
	{
		try
		{
			const current = await this._gateway.read(elicitation.conversationId, elicitation.requestId);
			if (generation === this._generation) this._elicitation.set(current);
		}
		catch { /* The bounded action error remains visible for explicit retry. */ }
	}
}
