import { EventType } from "@ag-ui/core";
import { ___DoWithTrace, ___GetActiveSpan } from "@opencrane/backend/observability";
import { __EncodeAgUiSseRecord, __ProjectAgUiEvent, __ProjectAgUiEvents } from "@opencrane/contracts";
import type { ConversationReplayCursor } from "@opencrane/models/conversations";

import { __EncodeConversationReplayCursor } from "./replay-cursor.js";
import { __ProjectConversationReplayEvent } from "./replay-projection.js";
import { ConversationReplayReadStatuses } from "./replay-reader.types.js";
import { ConversationLiveReplayOutcomes, type ConversationLiveReplayDependencies, type ConversationLiveReplaySink, type StreamConversationLiveReplayCommand } from "./conversation-live-replay.types.js";

/** Stream an authorized snapshot followed by a bounded recovery-polled live tail. */
export async function __StreamConversationLiveReplay(dependencies: ConversationLiveReplayDependencies, sink: ConversationLiveReplaySink, command: StreamConversationLiveReplayCommand): Promise<ConversationLiveReplayOutcomes>
{
	return ___DoWithTrace("conversation.replay.stream", { siloId: command.siloId, conversationId: command.conversationId, subjectId: command.subjectId, hasCursor: command.cursor !== null }, async function _traceReplay()
	{
		const outcome = await _streamConversationLiveReplay(dependencies, sink, command);
		___GetActiveSpan()?.setAttribute("outcome", outcome);
		return outcome;
	});
}

/** Execute the bounded replay loop inside the central trace boundary. */
async function _streamConversationLiveReplay(dependencies: ConversationLiveReplayDependencies, sink: ConversationLiveReplaySink, command: StreamConversationLiveReplayCommand): Promise<ConversationLiveReplayOutcomes>
{
	_Validate(dependencies);
	let cursor = command.cursor;
	let opened = false;
	let interruptFingerprint = "";
	const startedAt = dependencies.clock.now();
	let heartbeatAt = startedAt;
	while (!command.signal.aborted && dependencies.clock.now() - startedAt < dependencies.limits.maximumDurationMilliseconds)
	{
		const readCommand = { conversationId: command.conversationId, siloId: command.siloId, subjectId: command.subjectId, cursor, limit: dependencies.limits.pageSize };
		const result = dependencies.repository.readAuthorized === undefined
			? { status: ConversationReplayReadStatuses.Authorized, rows: await dependencies.repository.read(readCommand) }
			: await dependencies.repository.readAuthorized(readCommand);
		if (result.status === ConversationReplayReadStatuses.RevokedOrMissing)
		{
			if (opened) sink.write(_RevokedRecord());
			return ConversationLiveReplayOutcomes.RevokedOrMissing;
		}
		if (!opened) { sink.open(); opened = true; }
		cursor = _WriteRows(sink, command.conversationId, cursor, result.rows);

		// Open approvals are an overlay: reconnect restores them without changing Last-Event-ID.
		if (dependencies.interrupts !== undefined)
		{
			const overlays = await dependencies.interrupts.readOpen({ conversationId: command.conversationId, siloId: command.siloId, subjectId: command.subjectId });
			const fingerprint = JSON.stringify(overlays.map(event => event.payload.interrupt));
			if (fingerprint !== interruptFingerprint)
			{
				for (const overlay of overlays) sink.write(__EncodeAgUiSseRecord(__ProjectAgUiEvent({ ...overlay, cursor: undefined })));
				interruptFingerprint = fingerprint;
			}
		}
		if (result.rows.length >= dependencies.limits.pageSize) continue;
		await dependencies.clock.wait(dependencies.limits.pollMilliseconds, command.signal);
		if (command.signal.aborted) continue;
		if (dependencies.clock.now() - heartbeatAt >= dependencies.limits.heartbeatMilliseconds)
		{
			sink.write(": heartbeat\n\n");
			heartbeatAt = dependencies.clock.now();
		}
	}
	return command.signal.aborted ? ConversationLiveReplayOutcomes.Disconnected : ConversationLiveReplayOutcomes.DurationReached;
}

/** Write deterministic subframes and return the last emitted replay coordinate. */
function _WriteRows(sink: ConversationLiveReplaySink, conversationId: string, cursor: ConversationReplayCursor | null, rows: readonly import("./replay-projection.types.js").ConversationReplayEventRow[]): ConversationReplayCursor | null
{
	let next = cursor;
	for (const row of rows)
	{
		const source = __ProjectConversationReplayEvent(row);
		if (source === null) { next = { conversationId, position: row.position }; continue; }
		const events = __ProjectAgUiEvents({ ...source, cursor: undefined });
		const resumeAfter = cursor?.position === row.position ? cursor.subframe : undefined;
		for (let subframe = 0; subframe < events.length; subframe += 1)
		{
			if (resumeAfter !== undefined && subframe <= resumeAfter) continue;
			const id = __EncodeConversationReplayCursor({ conversationId, position: row.position, subframe });
			sink.write(__EncodeAgUiSseRecord({ id, event: "ag-ui", data: events[subframe]! }));
			next = { conversationId, position: row.position, subframe };
		}
	}
	return next;
}

/** Signal proven authority loss without leaking whether conversation or membership disappeared. */
function _RevokedRecord(): string
{
	return __EncodeAgUiSseRecord({ event: "ag-ui", data: { type: EventType.CUSTOM, name: "opencrane.access_revoked", value: { eventType: "access.revoked" } } });
}

/** Reject unsafe production bounds before opening a long-lived response. */
function _Validate(dependencies: ConversationLiveReplayDependencies): void
{
	const limits = dependencies.limits;
	if (!Number.isSafeInteger(limits.pageSize) || limits.pageSize < 1 || limits.pageSize > 500 || !Number.isSafeInteger(limits.pollMilliseconds) || limits.pollMilliseconds < 25 || !Number.isSafeInteger(limits.heartbeatMilliseconds) || limits.heartbeatMilliseconds <= limits.pollMilliseconds || limits.heartbeatMilliseconds >= 45_000 || !Number.isSafeInteger(limits.maximumDurationMilliseconds) || limits.maximumDurationMilliseconds < limits.heartbeatMilliseconds || limits.maximumDurationMilliseconds > 300_000) throw new TypeError("invalid live conversation replay limits");
}

/** Production clock using abort-aware bounded waits; wake-ups remain hints and polling recovers loss. */
export const CONVERSATION_LIVE_REPLAY_CLOCK: import("./conversation-live-replay.types.js").ConversationLiveReplayClock = {
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

/** Production bounds stay below channel-proxy idle/duration fences. */
export const CONVERSATION_LIVE_REPLAY_LIMITS: import("./conversation-live-replay.types.js").ConversationLiveReplayLimits = {
	pageSize: 200,
	pollMilliseconds: 1_000,
	heartbeatMilliseconds: 15_000,
	maximumDurationMilliseconds: 300_000,
};
