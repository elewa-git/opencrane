import { Injectable, computed, inject, signal } from "@angular/core";

import { AgentThreadGatewayError, AgentThreadGatewayErrorKinds } from "./agent-thread-gateway.errors.js";
import { __AgentThreadFailureRoute } from "./agent-thread-access-policy.js";
import { _AgentThreadFollowUpState } from "./agent-thread-follow-up.state.js";
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
	/** Controlled draft, command fence, and display-safe command failure. */
	private readonly _followUp = new _AgentThreadFollowUpState();
	/** Generation fence that rejects late reads and command completions. */
	private _generation = 0;
	/** Whether this store has ever held an authorized snapshot for the exact route. */
	private _hadAuthorizedSnapshot = false;
	/** Exact route whose prior authorization may justify the access-changed state. */
	private _routeKey: string | null = null;

	/** Current route state. */
	public readonly routeState = this._routeState.asReadonly();
	/** Exact authorized child snapshot. */
	public readonly snapshot = this._snapshot.asReadonly();
	/** Host-owned controlled composer draft. */
	public readonly draft = this._followUp.draft;
	/** Whether one follow-up command is active. */
	public readonly submitting = this._followUp.submitting;
	/** Display-safe recoverable error. */
	public readonly error = this._followUp.error;
	/** Whether current independent dimensions permit one follow-up. */
	public readonly canSendFollowUp = computed(this._CanSendFollowUp.bind(this));

	/** Load one exact parent-child route and collapse first-view absence or denial. */
	public async load(parentConversationId: string, childConversationId: string): Promise<void>
	{
		this._PrepareRoute(parentConversationId, childConversationId);
		const generation = ++this._generation;
		this._routeState.set(AgentThreadRouteStates.Loading);
		this._followUp.clearError();
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
	public async reconnect(): Promise<void> { const current = this._snapshot(); if (current !== null) await this.load(current.parentConversationId, current.childConversationId); }

	/** Adopt one controlled follow-up draft only while authorized child state is retained. */
	public updateDraft(draft: string): void { this._followUp.update(draft, this._routeState()); }

	/** Send one exact serial follow-up and adopt only a matching authoritative snapshot. */
	public async sendFollowUp(): Promise<boolean>
	{
		const current = this._snapshot();
		const body = this._followUp.draft();
		if (current === null || !this._CanSendFollowUp() || body.trim().length === 0) return false;
		const generation = this._followUp.begin();
		try
		{
			const next = await this._gateway.sendFollowUp(current.parentConversationId, current.childConversationId, body, globalThis.crypto.randomUUID());
			if (!this._followUp.isCurrent(generation)) return false;
			if (next.parentConversationId !== current.parentConversationId || next.childConversationId !== current.childConversationId)
			{
				this._followUp.fail(generation, "OpenCrane returned a different Agent thread. Nothing was sent again.");
				return false;
			}
			this._snapshot.set(next);
			this._followUp.succeed(generation);
			return true;
		}
		catch (error)
		{
			if (!this._followUp.isCurrent(generation)) return false;
			if (error instanceof AgentThreadGatewayError && error.kind !== AgentThreadGatewayErrorKinds.Recoverable)
			{
				this._HandleGatewayFailure(error);
				return false;
			}
			this._followUp.fail(generation, error instanceof Error ? error.message : "OpenCrane could not send this follow-up.");
			this.beginReconnect();
			return false;
		}
	}

	/** Whether the exact route, snapshot, recovery, and command states permit a follow-up. */
	private _CanSendFollowUp(): boolean { return this._followUp.canSend(this._routeState(), this._snapshot()); }

	/** Purge all child-derived state before exposing a restricted or unavailable route state. */
	private _PurgeAndSet(state: AgentThreadRouteStates.AccessChanged | AgentThreadRouteStates.Unavailable): void
	{
		this._snapshot.set(null);
		this._followUp.purge();
		this._routeState.set(state);
	}

	/** Clear every child-derived value before changing to a different exact route pair. */
	private _PrepareRoute(parentConversationId: string, childConversationId: string): void
	{
		const routeKey = `${parentConversationId}\u0000${childConversationId}`;
		if (this._routeKey === routeKey) return;
		this._routeKey = routeKey;
		this._hadAuthorizedSnapshot = false;
		this._snapshot.set(null);
		this._followUp.purge();
	}

	/** Collapse gateway errors while distinguishing only proven post-authorization revocation. */
	private _HandleGatewayFailure(error: unknown): void
	{
		const failureRoute = __AgentThreadFailureRoute(error, this._hadAuthorizedSnapshot);
		if (failureRoute !== null) this._PurgeAndSet(failureRoute);
		else
		{
			this._followUp.setError(error instanceof Error ? error.message : "OpenCrane could not load this Agent thread.");
			if (this._snapshot() !== null)
			{
				this.beginReconnect();
				this._routeState.set(AgentThreadRouteStates.Ready);
			}
		}
	}
}
