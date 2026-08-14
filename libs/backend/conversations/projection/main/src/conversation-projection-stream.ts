import { EventType } from "@ag-ui/core";
import { ___DoWithTrace, ___GetActiveSpan } from "@opencrane/backend/observability";
import { AG_UI_INTERRUPTS_CLEARED_EVENT } from "@opencrane/contracts";
import type { ConversationReplayCursor } from "@opencrane/contracts";

import { __ProjectAgUiEvents } from "./ag-ui-event-projector";
import { __EncodeAgUiSseRecord } from "./ag-ui-sse-encoder";
import { __EncodeConversationProjectionCursor } from "./conversation-projection-cursor";
import { __ProjectConversationEvent } from "./conversation-event-projector";
import type { ConversationProjectionEventRow } from "./conversation-event-projector.types";
import { ConversationProjectionReadStatuses } from "./conversation-projection-reader.types";
import { ConversationProjectionOutcomes, type ConversationProjectionDependencies, type ConversationProjectionSink, type StreamConversationProjectionCommand } from "./conversation-projection-stream.types";

/**
 * Streams an authorised conversation snapshot followed by a bounded live tail.
 *
 * The same function handles direct, group and agent-session conversations because it reads their
 * shared canonical timeline. Ordinary messages become text events; agent-session run rows may also
 * become run, tool, A2UI and interrupt events. Every durable row is redacted before it is mapped or
 * written.
 *
 * Called by: `__CreateConversationReplayRouter` and `__CreateSelfConversationReplayRouter`.
 *
 * @param dependencies Authorised page reader, optional interrupt overlay, time source and safe bounds.
 * @param sink Transport adapter that writes complete Server-Sent Event records.
 * @param command Trusted participant coordinates, cursor and cancellation signal.
 * @returns The reason this finite response stopped.
 * @throws {Error} When a canonical row is invalid or interrupt coordinates conflict.
 */
export async function __StreamConversationProjection(dependencies: ConversationProjectionDependencies, sink: ConversationProjectionSink, command: StreamConversationProjectionCommand): Promise<ConversationProjectionOutcomes>
{
	return ___DoWithTrace("conversation.projection.stream", { siloId: command.siloId, conversationId: command.conversationId, subjectId: command.subjectId, hasCursor: command.cursor !== null }, async function _TraceProjection()
	{
		const outcome = await _StreamConversationProjection(dependencies, sink, command);
		___GetActiveSpan()?.setAttribute("outcome", outcome);
		return outcome;
	});
}

/** Executes the bounded stream loop inside the central trace boundary. */
async function _StreamConversationProjection(dependencies: ConversationProjectionDependencies, sink: ConversationProjectionSink, command: StreamConversationProjectionCommand): Promise<ConversationProjectionOutcomes>
{
	_Validate(dependencies);
	let cursor = command.cursor;
	let opened = false;
	let interruptFingerprint: string | null = null;
	const startedAt = dependencies.clock.now();
	let heartbeatAt = startedAt;
	while (!command.signal.aborted && dependencies.clock.now() - startedAt < dependencies.limits.maximumDurationMilliseconds)
	{
		const readCommand = { conversationId: command.conversationId, siloId: command.siloId, subjectId: command.subjectId, cursor, limit: dependencies.limits.pageSize };
		const result = await dependencies.reader.readAuthorized(readCommand);
		if (result.status === ConversationProjectionReadStatuses.RevokedOrMissing)
		{
			if (opened) await _WriteSink(sink, _RevokedRecord(), command.signal);
			return ConversationProjectionOutcomes.RevokedOrMissing;
		}
		if (result.status !== ConversationProjectionReadStatuses.Authorized) throw new Error("conversation projection reader returned an unknown authority result");
		if (!opened) { sink.open(); opened = true; }
		cursor = await _WriteRows(sink, command.conversationId, cursor, result.rows, command.signal);

		// Open elicitations are an overlay: reconnect restores them without changing Last-Event-ID.
		if (dependencies.interrupts !== undefined)
		{
			const overlays = await dependencies.interrupts.readOpen({ conversationId: command.conversationId, siloId: command.siloId, subjectId: command.subjectId });
			const fingerprint = JSON.stringify(overlays.map(event => event.payload.interrupt));
			if (fingerprint !== interruptFingerprint)
			{
				await _WriteInterruptSnapshot(sink, command.conversationId, overlays, command.signal);
				interruptFingerprint = fingerprint;
			}
		}
		if (result.rows.length >= dependencies.limits.pageSize) continue;
		await dependencies.clock.wait(dependencies.limits.pollMilliseconds, command.signal);
		if (command.signal.aborted) continue;
		if (dependencies.clock.now() - heartbeatAt >= dependencies.limits.heartbeatMilliseconds)
		{
			await _WriteSink(sink, ": heartbeat\n\n", command.signal);
			heartbeatAt = dependencies.clock.now();
		}
	}
	return command.signal.aborted ? ConversationProjectionOutcomes.Disconnected : ConversationProjectionOutcomes.DurationReached;
}

/** Replace the complete cursorless interrupt overlay, including an explicit empty-set marker. */
async function _WriteInterruptSnapshot(sink: ConversationProjectionSink, conversationId: string, overlays: readonly import("@opencrane/contracts").AgUiProjectionSourceEvent[], signal: AbortSignal): Promise<void>
{
	if (overlays.length === 0)
	{
		await _WriteSink(sink, __EncodeAgUiSseRecord({ event: "ag-ui", data: { type: EventType.CUSTOM, name: AG_UI_INTERRUPTS_CLEARED_EVENT, value: { eventType: AG_UI_INTERRUPTS_CLEARED_EVENT } } }), signal);
		return;
	}
	const runId = overlays[0]?.runId;
	const interrupts = overlays.map(function _Interrupt(overlay)
	{
		if (overlay.conversationId !== conversationId || overlay.runId === undefined || overlay.runId !== runId || overlay.payload.interrupt === undefined) throw new Error("open conversation interrupts have inconsistent coordinates");
		return overlay.payload.interrupt;
	});
	if (runId === undefined) throw new Error("open conversation interrupts require a run coordinate");
	await _WriteSink(sink, __EncodeAgUiSseRecord({ event: "ag-ui", data: { type: EventType.RUN_FINISHED, threadId: conversationId, runId, outcome: { type: "interrupt", interrupts } } }), signal);
}

/** Write deterministic subframes and return the last emitted replay coordinate. */
async function _WriteRows(sink: ConversationProjectionSink, conversationId: string, cursor: ConversationReplayCursor | null, rows: readonly ConversationProjectionEventRow[], signal: AbortSignal): Promise<ConversationReplayCursor | null>
{
	let next = cursor;
	for (const row of rows)
	{
		const source = __ProjectConversationEvent(row);
		if (source === null) throw new Error("canonical conversation projection row is invalid");
		const events = __ProjectAgUiEvents({ ...source, cursor: undefined });
		const resumeAfter = cursor?.position === row.position ? cursor.subframe : undefined;
		for (let subframe = 0; subframe < events.length; subframe += 1)
		{
			if (resumeAfter !== undefined && subframe <= resumeAfter) continue;
			const id = __EncodeConversationProjectionCursor({ conversationId, position: row.position, subframe });
			await _WriteSink(sink, __EncodeAgUiSseRecord({ id, event: "ag-ui", data: events[subframe]! }), signal);
			next = { conversationId, position: row.position, subframe };
		}
	}
	return next;
}

/** Respect Node writable backpressure before reading or projecting more authority rows. */
async function _WriteSink(sink: ConversationProjectionSink, value: string, signal: AbortSignal): Promise<void>
{
	if (!sink.write(value)) await sink.drain(signal);
}

/** Signal proven authority loss without leaking whether conversation or membership disappeared. */
function _RevokedRecord(): string
{
	return __EncodeAgUiSseRecord({ event: "ag-ui", data: { type: EventType.CUSTOM, name: "opencrane.access_revoked", value: { eventType: "access.revoked" } } });
}

/** Reject unsafe production bounds before opening a long-lived response. */
function _Validate(dependencies: ConversationProjectionDependencies): void
{
	const limits = dependencies.limits;
	if (!Number.isSafeInteger(limits.pageSize) || limits.pageSize < 1 || limits.pageSize > 500 || !Number.isSafeInteger(limits.pollMilliseconds) || limits.pollMilliseconds < 25 || !Number.isSafeInteger(limits.heartbeatMilliseconds) || limits.heartbeatMilliseconds <= limits.pollMilliseconds || limits.heartbeatMilliseconds >= 45_000 || !Number.isSafeInteger(limits.maximumDurationMilliseconds) || limits.maximumDurationMilliseconds < limits.heartbeatMilliseconds || limits.maximumDurationMilliseconds > 300_000) throw new TypeError("invalid live conversation replay limits");
}

/**
 * Provides the production time source and abort-aware wait used by the live stream.
 *
 * Polling remains authoritative: a wake-up only controls when the reader is asked again.
 *
 * Called by: the OpenCrane server conversation route composition.
 */
export const CONVERSATION_PROJECTION_CLOCK: import("./conversation-projection-stream.types").ConversationProjectionClock = {
	now: () => Date.now(),
	wait: async function _Wait(milliseconds, signal): Promise<void>
	{
		if (signal.aborted) return;
		await new Promise<void>(function _Until(resolve)
		{
			function _Finish(): void
			{
				clearTimeout(timeout);
				signal.removeEventListener("abort", _Abort);
				resolve();
			}
			function _Abort(): void { _Finish(); }
			const timeout = setTimeout(_Finish, milliseconds);
			signal.addEventListener("abort", _Abort, { once: true });
		});
	},
};

/**
 * Keeps production polling, heartbeats and response duration below proxy connection fences.
 *
 * Called by: the OpenCrane server conversation route composition.
 */
export const CONVERSATION_PROJECTION_LIMITS: import("./conversation-projection-stream.types").ConversationProjectionLimits = {
	pageSize: 200,
	pollMilliseconds: 1_000,
	heartbeatMilliseconds: 15_000,
	maximumDurationMilliseconds: 300_000,
};
