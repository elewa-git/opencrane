import { Injectable, inject } from "@angular/core";

import { ___ConversationEntrySchema, ConversationComputerStates, type ConversationComputer, type ConversationEntry } from "@opencrane/contracts";
import { ControlPlaneApiService } from "@opencrane/core";
import { __CreateConversationHistoryProjection, ConversationEventStreamStatuses, type ConversationEventStream, type ConversationEventStreamUpdate, type ConversationHistoryProjection, type StreamConversationEventsCommand } from "@opencrane/state/conversation/stream";

/** Default interval between finite history reads after the server reports that the browser is caught up. */
const _POLL_DELAY_MILLISECONDS = 1_000;

/** Polls the signed-in conversation-history API without opening a browser execution socket. */
@Injectable()
export class OpenCraneConversationEventStream implements ConversationEventStream
{
	/** Generated API client whose same-origin session identifies the participant. */
	private readonly _api = inject(ControlPlaneApiService);

	/** Read finite Kurrent-backed history ranges until the selection is aborted. */
	public async stream(command: StreamConversationEventsCommand): Promise<ConversationHistoryProjection>
	{
		_ValidateCommand(command);
		let state = command.initialState ?? __CreateConversationHistoryProjection();
		let reconnectAttempt = 0;
		let lastHeartbeatAt: number | null = null;
		let hasReadHistory = command.initialState !== undefined && command.initialState.entries.length > 0;
		_Emit(command, { status: ConversationEventStreamStatuses.Connecting, state, reconnectAttempt, lastHeartbeatAt });

		while (!command.signal.aborted)
		{
			try
			{
				const next = await this._Read(command.conversationId, hasReadHistory ? state.nextPosition : undefined);
				state = _Merge(state, next);
				hasReadHistory = true;
				reconnectAttempt = 0;
				lastHeartbeatAt = Date.now();
				_Emit(command, { status: ConversationEventStreamStatuses.Live, state, reconnectAttempt, lastHeartbeatAt });
				await _Wait(command.pollDelayMilliseconds ?? _POLL_DELAY_MILLISECONDS, command.signal);
			}
			catch (error)
			{
				if (command.signal.aborted)
					break;
				reconnectAttempt += 1;
				if (reconnectAttempt > (command.maximumReconnectAttempts ?? 3))
					_Fail(command, state, reconnectAttempt, lastHeartbeatAt, error);
				_Emit(command, { status: ConversationEventStreamStatuses.Reconnecting, state, reconnectAttempt, lastHeartbeatAt });
				await _Wait(command.reconnectDelayMilliseconds ?? 250, command.signal);
			}
		}

		_Emit(command, { status: ConversationEventStreamStatuses.Aborted, state, reconnectAttempt, lastHeartbeatAt });
		return state;
	}

	/** Read entries strictly after the supplied canonical decimal position. */
	private async _Read(conversationId: string, afterPosition: string | undefined): Promise<ConversationHistoryProjection>
	{
		const params = afterPosition === undefined ? { path: { conversationId } } : { path: { conversationId }, query: { afterPosition } };
		const result = await this._api.client.GET("/me/conversations/{conversationId}/history", { params });
		if (result.error !== undefined || result.data === undefined)
			throw new Error("conversation history is unavailable");
		return _Projection(result.data);
	}
}

/** Validate and narrow one generated history response before browser state adopts it. */
function _Projection(value: unknown): ConversationHistoryProjection
{
	if (typeof value !== "object" || value === null)
		throw new Error("invalid conversation history response");
	const record = value as Record<string, unknown>;
	if (!Array.isArray(record["entries"])
		|| typeof record["payloads"] !== "object" || record["payloads"] === null || typeof record["nextPosition"] !== "string")
		throw new Error("invalid conversation history response");
	const entries: ConversationEntry[] = record["entries"].map(function _Entry(entry)
	{
		const parsed = ___ConversationEntrySchema.safeParse(entry);
		if (!parsed.success)
			throw new Error("invalid conversation history entry");
		return parsed.data;
	});
	const payloads = _Payloads(record["payloads"]);
	const computer = _Computer(record["computer"]);
	return { entries, payloads, nextPosition: record["nextPosition"], computer };
}

/** Accept only string-valued private payload resolutions. */
function _Payloads(value: object): Readonly<Record<string, string>>
{
	const payloads: Record<string, string> = {};
	for (const [reference, text] of Object.entries(value))
	{
		if (typeof text !== "string")
			throw new Error("invalid conversation payload resolution");
		payloads[reference] = text;
	}
	return payloads;
}

/** Check the fields the workspace reads from the current logical computer projection. */
function _Computer(value: unknown): ConversationComputer | null
{
	if (value === null)
		return null;
	if (typeof value !== "object")
		throw new Error("invalid conversation computer response");
	const computer = value as Partial<ConversationComputer>;
	if (typeof computer.id !== "string" || typeof computer.conversationId !== "string" || !Object.values(ConversationComputerStates).includes(computer.state as ConversationComputerStates))
		throw new Error("invalid conversation computer response");
	return computer as ConversationComputer;
}

/** Append only entries not already held and adopt the latest payload and computer projections. */
function _Merge(current: ConversationHistoryProjection, next: ConversationHistoryProjection): ConversationHistoryProjection
{
	const positions = new Set(current.entries.map(entry => entry.position));
	const entries = [...current.entries, ...next.entries.filter(entry => !positions.has(entry.position))];
	return { entries, payloads: { ...current.payloads, ...next.payloads }, nextPosition: next.nextPosition, computer: next.computer };
}

/** Reject invalid polling options before the first authenticated request. */
function _ValidateCommand(command: StreamConversationEventsCommand): void
{
	if (command.conversationId.trim().length === 0)
		throw new Error("conversation id is required");
	if (command.maximumReconnectAttempts !== undefined && (!Number.isSafeInteger(command.maximumReconnectAttempts)
		|| command.maximumReconnectAttempts < 0 || command.maximumReconnectAttempts > 10))
		throw new Error("maximum reconnect attempts must be between zero and ten");
}

/** Wait for the next finite read but resolve immediately when the caller changes selection. */
async function _Wait(milliseconds: number, signal: AbortSignal): Promise<void>
{
	if (signal.aborted || milliseconds === 0)
		return;
	await new Promise<void>(function _Until(resolve)
	{
		const timeout = setTimeout(resolve, milliseconds);
		signal.addEventListener("abort", function _Abort() { clearTimeout(timeout); resolve(); }, { once: true });
	});
}

/** Publish one lifecycle report when the caller supplied an observer. */
function _Emit(command: StreamConversationEventsCommand, update: ConversationEventStreamUpdate): void { command.onUpdate?.(update); }

/** Publish the terminal state and stop polling with fixed browser-safe copy. */
function _Fail(command: StreamConversationEventsCommand, state: ConversationHistoryProjection, reconnectAttempt: number, lastHeartbeatAt: number | null, error: unknown): never
{
	_Emit(command, { status: ConversationEventStreamStatuses.Failed, state, reconnectAttempt, lastHeartbeatAt, error: "Conversation history is unavailable." });
	throw new Error("conversation history polling failed", { cause: error });
}
