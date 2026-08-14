import { signal } from "@angular/core";

import { AgentThreadRecoveryStates, AgentThreadRouteStates } from "./agent-thread-state.types.js";
import type { AgentThreadSnapshot } from "./agent-thread.types.js";

/** Local controlled-draft and one-command fence for a component-scoped Agent-thread store. */
export class _AgentThreadFollowUpState
{
	/** Controlled follow-up draft retained through reconnect only. */
	private readonly _draft = signal("");
	/** One active follow-up command fence. */
	private readonly _submitting = signal(false);
	/** Display-safe recoverable failure. */
	private readonly _error = signal<string | null>(null);
	/** Generation that invalidates late command completion after a purge. */
	private _generation = 0;

	/** Host-owned controlled composer draft. */
	public readonly draft = this._draft.asReadonly();
	/** Whether one follow-up command is active. */
	public readonly submitting = this._submitting.asReadonly();
	/** Display-safe recoverable error. */
	public readonly error = this._error.asReadonly();

	/** Whether exact route, snapshot, recovery, and command state permit a follow-up. */
	public canSend(routeState: AgentThreadRouteStates, snapshot: AgentThreadSnapshot | null): boolean
	{
		return routeState === AgentThreadRouteStates.Ready && snapshot !== null && snapshot.recovery === AgentThreadRecoveryStates.Live && snapshot.canSendFollowUp && !this._submitting();
	}

	/** Adopt one controlled draft only for retained authorized route state. */
	public update(draft: string, routeState: AgentThreadRouteStates): void { if (routeState === AgentThreadRouteStates.Ready) this._draft.set(draft); }

	/** Clear a prior display-safe failure before a new read begins. */
	public clearError(): void { this._error.set(null); }

	/** Show one display-safe route or reconnect failure without changing command state. */
	public setError(message: string): void { this._error.set(message); }

	/** Start one command and return its local generation fence. */
	public begin(): number
	{
		this._submitting.set(true);
		this._error.set(null);
		return this._generation;
	}

	/** Whether a command completion still belongs to retained child state. */
	public isCurrent(generation: number): boolean { return generation === this._generation; }

	/** Finish a successful current command and clear its consumed draft. */
	public succeed(generation: number): void
	{
		if (!this.isCurrent(generation)) return;
		this._draft.set("");
		this._submitting.set(false);
	}

	/** Keep a current draft and show one display-safe command or reconnect failure. */
	public fail(generation: number, message: string): void
	{
		if (!this.isCurrent(generation)) return;
		this._error.set(message);
		this._submitting.set(false);
	}

	/** Purge every child-derived command value and invalidate late completion. */
	public purge(): void
	{
		this._generation += 1;
		this._draft.set("");
		this._submitting.set(false);
		this._error.set(null);
	}
}
