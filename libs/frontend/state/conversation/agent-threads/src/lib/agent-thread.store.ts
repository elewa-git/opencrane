import { Injectable, computed, inject, signal } from "@angular/core";

import { AgentThreadGatewayError, AgentThreadGatewayErrorKinds } from "./agent-thread-gateway.errors.js";
import { AGENT_THREAD_GATEWAY } from "./agent-thread.gateway.js";
import { AgentThreadRecoveryStates, AgentThreadRouteStates, type AgentThreadSnapshot } from "./agent-thread.types.js";

/** Component-scoped state for one full-page Agent-thread route. */
@Injectable()
export class AgentThreadStore
{
	/** Authorized API port implemented later by the generated-client adapter. */
	private readonly _gateway = inject(AGENT_THREAD_GATEWAY);
	/** Current route state, intentionally separate from run and recovery state. */
	private readonly _routeState = signal(AgentThreadRouteStates.Loading);
	/** Exact authorized snapshot, or null after every purge. */
	private readonly _snapshot = signal<AgentThreadSnapshot | null>(null);
	/** Controlled follow-up draft retained through reconnect only. */
	private readonly _draft = signal("");
	/** One active follow-up command fence. */
	private readonly _submitting = signal(false);
	/** Display-safe recoverable failure. */
	private readonly _error = signal<string | null>(null);
	/** Generation fence that rejects late reads and command completions. */
	private _generation = 0;
	/** Whether this store has ever held an authorized snapshot for the exact route. */
	private _hadAuthorizedSnapshot = false;

	/** Current route state. */
	public readonly routeState = this._routeState.asReadonly();
	/** Exact authorized child snapshot. */
	public readonly snapshot = this._snapshot.asReadonly();
	/** Host-owned controlled composer draft. */
	public readonly draft = this._draft.asReadonly();
	/** Whether one follow-up command is active. */
	public readonly submitting = this._submitting.asReadonly();
	/** Display-safe recoverable error. */
	public readonly error = this._error.asReadonly();
	/** Whether current independent dimensions permit one follow-up. */
	public readonly canSendFollowUp = computed(this._CanSendFollowUp.bind(this));

	/** Load one exact parent-child route and collapse first-view absence or denial. */
	public async load(parentConversationId: string, childConversationId: string): Promise<void>
	{
		const generation = ++this._generation;
		this._routeState.set(AgentThreadRouteStates.Loading);
		this._error.set(null);
		try
		{
			const snapshot = await this._gateway.read(parentConversationId, childConversationId);
			if (generation !== this._generation) return;
			if (snapshot.parentConversationId !== parentConversationId || snapshot.childConversationId !== childConversationId)
			{
				this._PurgeAndSet(AgentThreadRouteStates.Unavailable);
				return;
			}
			this._snapshot.set(snapshot);
			this._routeState.set(AgentThreadRouteStates.Ready);
			this._hadAuthorizedSnapshot = true;
		}
		catch (error) { if (generation === this._generation) this._HandleGatewayFailure(error); }
	}

	/** Mark live delivery as reconnecting without discarding the accepted snapshot or draft. */
	public beginReconnect(): void
	{
		const current = this._snapshot();
		if (current !== null) this._snapshot.set({ ...current, recovery: AgentThreadRecoveryStates.Reconnecting });
	}

	/** Reload from the exact accepted route coordinates after a live-delivery interruption. */
	public async reconnect(): Promise<void>
	{
		const current = this._snapshot();
		if (current === null) return;
		await this.load(current.parentConversationId, current.childConversationId);
	}

	/** Adopt one controlled follow-up draft only while authorized child state is retained. */
	public updateDraft(draft: string): void
	{
		if (this._routeState() === AgentThreadRouteStates.Ready) this._draft.set(draft);
	}

	/** Send one exact serial follow-up and adopt only a matching authoritative snapshot. */
	public async sendFollowUp(): Promise<boolean>
	{
		const current = this._snapshot();
		const body = this._draft();
		if (current === null || !this._CanSendFollowUp() || body.trim().length === 0) return false;
		const generation = this._generation;
		this._submitting.set(true);
		this._error.set(null);
		try
		{
			const next = await this._gateway.sendFollowUp(current.childConversationId, body, globalThis.crypto.randomUUID());
			if (generation !== this._generation || next.parentConversationId !== current.parentConversationId || next.childConversationId !== current.childConversationId) return false;
			this._snapshot.set(next);
			this._draft.set("");
			return true;
		}
		catch (error)
		{
			if (generation !== this._generation) return false;
			if (error instanceof AgentThreadGatewayError && error.kind !== AgentThreadGatewayErrorKinds.Recoverable)
			{
				this._HandleGatewayFailure(error);
				return false;
			}
			this._error.set(error instanceof Error ? error.message : "OpenCrane could not send this follow-up.");
			this.beginReconnect();
			return false;
		}
		finally { if (generation === this._generation) this._submitting.set(false); }
	}

	/** Whether the exact route, snapshot, recovery, and command states permit a follow-up. */
	private _CanSendFollowUp(): boolean
	{
		const current = this._snapshot();
		return this._routeState() === AgentThreadRouteStates.Ready && current !== null && current.recovery === AgentThreadRecoveryStates.Live && current.canSendFollowUp && !this._submitting();
	}

	/** Purge all child-derived state before exposing a restricted or unavailable route state. */
	private _PurgeAndSet(state: AgentThreadRouteStates.AccessChanged | AgentThreadRouteStates.Unavailable): void
	{
		this._snapshot.set(null);
		this._draft.set("");
		this._error.set(null);
		this._routeState.set(state);
	}

	/** Collapse gateway errors while distinguishing only proven post-authorization revocation. */
	private _HandleGatewayFailure(error: unknown): void
	{
		if (!(error instanceof AgentThreadGatewayError))
		{
			this._error.set("OpenCrane could not load this Agent thread.");
			return;
		}
		if (error.kind === AgentThreadGatewayErrorKinds.AccessChanged && this._hadAuthorizedSnapshot)
		{
			this._PurgeAndSet(AgentThreadRouteStates.AccessChanged);
			return;
		}
		if (error.kind === AgentThreadGatewayErrorKinds.Unavailable || error.kind === AgentThreadGatewayErrorKinds.AccessChanged)
		{
			this._PurgeAndSet(AgentThreadRouteStates.Unavailable);
			return;
		}
		this._error.set(error.message);
	}
}
