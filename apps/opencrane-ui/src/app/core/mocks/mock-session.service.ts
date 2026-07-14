import { Injectable, inject, signal } from "@angular/core";

import { UiMessageRole, UiMessageStatus, UiSessionState } from "../models/session.types.js";
import { UiMockScenario } from "../models/mock-scenario.types.js";
import { UiMutationPhase, UiMutationState } from "../models/ui-data.types.js";
import { UiSessionDataSource } from "../state/session-data-source.types.js";
import { _DefaultSessionState } from "./fixtures/session.fixtures.js";
import { MockClockService } from "./mock-clock.service.js";
import { MockIdentityService } from "./mock-identity.service.js";
import { MockScenarioService } from "./mock-scenario.service.js";

/** Owns deterministic in-memory Session state for the mock UI build. */
@Injectable()
export class MockSessionService implements UiSessionDataSource
{
	/** Deterministic delay applied to every mock Session mutation. */
	private static readonly MUTATION_DELAY_MS = 240;

	/** Scenario owner that resets Session state when tests select a new mode. */
	private readonly _scenarios = inject(MockScenarioService);

	/** Deterministic clock used for generated message identifiers. */
	private readonly _clock = inject(MockClockService);

	/** Deterministic identity owner exposed through the provider-neutral contract. */
	private readonly _identity = inject(MockIdentityService);

	/** Mutable complete Session state. */
	private readonly _state = signal<UiSessionState>(_DefaultSessionState());

	/** Mutable lifecycle of the most recent Session mutation. */
	private readonly _mutation = signal<UiMutationState>(_IdleMutation());

	/** Pending clock task identifier, or null when no mutation is queued. */
	private _pendingTaskId: number | null = null;

	/** Read-only complete Session state exposed to the facade. */
	public readonly state = this._state.asReadonly();

	/** Read-only identity and route-access state exposed to the facade. */
	public readonly access = this._identity.access;

	/** Provider-neutral presentation flags exposed to the facade. */
	public readonly presentation = this._scenarios.presentation;

	/** Read-only lifecycle of the most recent Session mutation. */
	public readonly mutation = this._mutation.asReadonly();

	/** Initializes Session state from the URL-selected scenario. */
	public constructor()
	{
		this.reset(this._scenarios.scenario());
	}

	/** Selects an existing Session route. */
	public selectSession(sessionId: string | null): void
	{
		this._state.update(function _select(state: UiSessionState): UiSessionState
		{
			return { ...state, selectedSessionId: sessionId };
		});
	}

	/** Schedules a deterministic user/assistant exchange through the mock store. */
	public sendMessage(content: string): void
	{
		const trimmed = content.trim();
		if (!trimmed)
		{
			this._mutation.set({ phase: UiMutationPhase.Error, operation: "send-message", error: "Enter a message before sending." });
			return;
		}

		this.cancelMutation();
		this._mutation.set({ phase: UiMutationPhase.Pending, operation: "send-message", error: null });
		this._pendingTaskId = this._clock.schedule(function _CompleteMessage(this: MockSessionService): void
		{
			this._pendingTaskId = null;
			if (this._MutationError())
			{
				this._mutation.set({ phase: UiMutationPhase.Error, operation: "send-message", error: this._MutationError() });
				return;
			}
			this._AppendExchange(trimmed);
			this._mutation.set({ phase: UiMutationPhase.Success, operation: "send-message", error: null });
		}.bind(this), MockSessionService.MUTATION_DELAY_MS);
	}

	/** Appends one completed deterministic exchange after the scheduled mutation succeeds. */
	private _AppendExchange(content: string): void
	{
		const userId = this._clock.nextId("message-user-generated");
		const assistantId = this._clock.nextId("message-assistant-generated");
		this._state.update(function _append(state: UiSessionState): UiSessionState
		{
			return {
				...state,
				messages:
				[
					...state.messages,
					{ id: userId, role: UiMessageRole.User, content, status: UiMessageStatus.Complete, citations: [] },
					{ id: assistantId, role: UiMessageRole.Assistant, content: "I’ll turn that into a concise plan.", status: UiMessageStatus.Streaming, citations: [] }
				]
			};
		});
	}

	/** Marks any streaming output as cancelled. */
	public cancelStreaming(): void
	{
		this.cancelMutation();
		this._state.update(function _cancel(state: UiSessionState): UiSessionState
		{
			return {
				...state,
				messages: state.messages.map(function _cancelMessage(message)
				{
					return message.status === UiMessageStatus.Streaming ? { ...message, status: UiMessageStatus.Cancelled } : message;
				})
			};
		});
	}

	/** Cancels a pending Session mutation before it changes the store. */
	public cancelMutation(): void
	{
		if (this._pendingTaskId === null)
		{
			return;
		}
		this._clock.cancel(this._pendingTaskId);
		this._pendingTaskId = null;
		this._mutation.set({ phase: UiMutationPhase.Cancelled, operation: "send-message", error: null });
	}

	/** Restores Session state for one deterministic scenario. */
	public reset(scenario: UiMockScenario = this._scenarios.scenario()): void
	{
		if (this._pendingTaskId !== null)
		{
			this._clock.cancel(this._pendingTaskId);
			this._pendingTaskId = null;
		}
		this._mutation.set(_IdleMutation());
		const state = _DefaultSessionState();
		if (scenario === UiMockScenario.Empty)
		{
			this._state.set({ ...state, sessions: [], selectedSessionId: null, messages: [] });
			return;
		}
		if (scenario === UiMockScenario.Offline)
		{
			this._state.set({ ...state, connected: false });
			return;
		}
		if (scenario === UiMockScenario.LongContent)
		{
			this._state.set({
				...state,
				sessions: state.sessions.map(function _LengthenSession(session)
				{
					return { ...session, title: `${session.title} — cross-functional decisions, dependencies, risks, owners, and delivery milestones` };
				}),
				messages: state.messages.map(function _LengthenMessage(message)
				{
					return { ...message, content: `${message.content} This deterministic paragraph verifies wrapping, narrow layouts, and overflow without relying on generated content.` };
				})
			});
			return;
		}
		this._state.set(state);
	}

	/** Maps the active scenario to a recoverable Session mutation error. */
	private _MutationError(): string | null
	{
		const scenario = this._scenarios.scenario();
		if (scenario === UiMockScenario.Error)
		{
			return "The mock Session provider could not send this message.";
		}
		if (scenario === UiMockScenario.Permission)
		{
			return "You do not have permission to send messages in this Session.";
		}
		if (scenario === UiMockScenario.Offline)
		{
			return "Reconnect before sending this message.";
		}
		return null;
	}
}

/** Creates a fresh idle mutation state for initialization and reset. */
function _IdleMutation(): UiMutationState
{
	return { phase: UiMutationPhase.Idle, operation: null, error: null };
}
