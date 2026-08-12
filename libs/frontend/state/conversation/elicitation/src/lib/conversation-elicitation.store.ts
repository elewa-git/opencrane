import { Injectable, computed, inject, signal } from "@angular/core";

import { ElicitationRequestStates, type ConversationElicitation, type ElicitationResponseValue } from "@opencrane/contracts";

import { ElicitationGatewayError, ElicitationGatewayErrorKinds } from "./elicitation-gateway.errors.js";
import { ELICITATION_GATEWAY } from "./opencrane-conversation-elicitation.gateway.js";

/** Component-scoped state for one recoverable question or approval. */
@Injectable()
export class ConversationElicitationStore
{
	/** Signed-in API port. */
	private readonly _gateway = inject(ELICITATION_GATEWAY);
	/** Current authoritative request. */
	private readonly _elicitation = signal<ConversationElicitation | null>(null);
	/** Selected-but-not-submitted response retained through step-up. */
	private readonly _draft = signal<ElicitationResponseValue | null>(null);
	/** One active browser command fence. */
	private readonly _busy = signal(false);
	/** Bounded user-facing command failure. */
	private readonly _error = signal<string | null>(null);
	/** Same-origin path used for verified reauthentication. */
	private readonly _stepUpPath = signal<string | null>(null);
	/** Request whose control should regain focus after step-up reconciliation. */
	private readonly _restoreFocusRequestId = signal<string | null>(null);
	/** Generation rejecting late completions after another request is loaded. */
	private _generation = 0;

	public readonly elicitation = this._elicitation.asReadonly();
	public readonly draft = this._draft.asReadonly();
	public readonly busy = this._busy.asReadonly();
	public readonly error = this._error.asReadonly();
	public readonly stepUpPath = this._stepUpPath.asReadonly();
	public readonly restoreFocusRequestId = this._restoreFocusRequestId.asReadonly();
	public readonly canSubmit = computed(this._CanSubmit.bind(this));

	/** Read and adopt one exact request, clearing drafts only when its identity changed. */
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

	/** Retain a typed local selection without claiming it was submitted. */
	public select(response: ElicitationResponseValue): void
	{
		const elicitation = this._elicitation();
		if (elicitation === null || elicitation.state !== ElicitationRequestStates.Requested || response.kind !== elicitation.body.kind) return;
		this._draft.set(response);
		this._error.set(null);
	}

	/** Submit the selected response once and adopt only the authoritative terminal projection. */
	public async submit(): Promise<boolean>
	{
		const elicitation = this._elicitation();
		const draft = this._draft();
		if (elicitation === null || draft === null || !this._CanSubmit()) return false;
		const generation = this._generation;
		this._busy.set(true);
		this._error.set(null);
		try
		{
			const projection = await this._gateway.respond(elicitation.conversationId, elicitation.requestId, { idempotencyKey: globalThis.crypto.randomUUID(), response: draft });
			if (generation !== this._generation || projection.requestId !== this._elicitation()?.requestId) return false;
			this._elicitation.update(function _Terminal(current) { return current === null ? null : { ...current, state: projection.state, resolvedAt: projection.resolvedAt }; });
			this._draft.set(null);
			this._stepUpPath.set(null);
			return true;
		}
		catch (error)
		{
			if (generation !== this._generation) return false;
			if (error instanceof ElicitationGatewayError && error.kind === ElicitationGatewayErrorKinds.StepUpRequired)
			{
				this._stepUpPath.set(error.reauthenticatePath);
				this._restoreFocusRequestId.set(elicitation.requestId);
				this._error.set(error.message);
				return false;
			}
			this._error.set(error instanceof Error ? error.message : "OpenCrane could not save this response.");
			await this._Reconcile(elicitation, generation);
			return false;
		}
		finally { if (generation === this._generation) this._busy.set(false); }
	}

	/** Reload after returning from step-up while preserving the selected draft and focus target. */
	public async recoverAfterStepUp(): Promise<void>
	{
		const current = this._elicitation();
		if (current === null) return;
		this._stepUpPath.set(null);
		await this.load(current.conversationId, current.requestId);
	}

	/** Clear a consumed focus restoration signal. */
	public acknowledgeFocusRestored(): void { this._restoreFocusRequestId.set(null); }

	/** Drop the selected request, its draft, and every recovery coordinate. */
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

	/** Whether exact current state permits one response submission. */
	private _CanSubmit(): boolean { return !this._busy() && this._draft() !== null && this._elicitation()?.state === ElicitationRequestStates.Requested; }

	/** Adopt the durable winner after an uncertain transport outcome. */
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
