import { describe, expect, it, vi } from "vitest";

import { KurrentConversationComputerActivityReader, _ConversationComputerActiveTurnStreamName } from "../conversation-computer-activity";
import { KurrentConversationComputerTurnStore } from "../conversation-computer-turn-store";

const _COMMAND = { siloId: "silo-1", computerId: "computer-1", generation: 2, leaseId: "lease-2" };

function _Reader(events: readonly Record<string, unknown>[])
{
	const streamName = _ConversationComputerActiveTurnStreamName(_COMMAND);
	const readHead = vi.fn().mockResolvedValue({ streamName, revision: events.length === 0 ? null : BigInt(events.length - 1) });
	const readStream = vi.fn(async function* _Read(request: { readonly streamName: string; readonly fromRevision?: bigint })
	{
		for (const [index, event] of events.entries())
			if (request.fromRevision === undefined || BigInt(index) >= request.fromRevision)
				yield { ...event, streamName, revision: BigInt(index) };
	});
	return { reader: new KurrentConversationComputerActivityReader({ readHead, readStream } as never), readHead, readStream, streamName };
}

describe("KurrentConversationComputerActivityReader", function _Suite()
{
	it("returns null for a lease that never bootstrapped a turn", async function _NoTurns()
	{
		const { reader } = _Reader([]);
		await expect(reader.lastActivity(_COMMAND)).resolves.toBeNull();
	});

	it("reports the newest settled turn as idle activity from its head event only", async function _Settled()
	{
		const { reader, readStream } = _Reader([
			{ id: "a", type: "opencrane.conversation-computer-turn-active.v1", data: { bootstrapId: "turn-1", ..._COMMAND }, metadata: {}, recordedAt: new Date("2026-09-05T12:00:00.000Z") },
			{ id: "b", type: "opencrane.conversation-computer-turn-settled.v1", data: { bootstrapId: "turn-1" }, metadata: {}, recordedAt: new Date("2026-09-05T12:07:00.000Z") },
		]);
		await expect(reader.lastActivity(_COMMAND)).resolves.toEqual({ lastActivityAt: new Date("2026-09-05T12:07:00.000Z"), busy: false });
		expect(readStream).toHaveBeenCalledWith({ streamName: _ConversationComputerActiveTurnStreamName(_COMMAND), fromRevision: 1n });
	});

	it("reports an unsettled turn as busy and rejects a foreign lease in the stream", async function _Busy()
	{
		const busy = _Reader([{ id: "a", type: "opencrane.conversation-computer-turn-active.v1", data: { bootstrapId: "turn-2", ..._COMMAND }, metadata: {}, recordedAt: new Date("2026-09-05T12:10:00.000Z") }]);
		await expect(busy.reader.lastActivity(_COMMAND)).resolves.toEqual({ lastActivityAt: new Date("2026-09-05T12:10:00.000Z"), busy: true });

		const foreign = _Reader([{ id: "a", type: "opencrane.conversation-computer-turn-active.v1", data: { bootstrapId: "turn-2", ..._COMMAND, leaseId: "lease-9" }, metadata: {}, recordedAt: new Date("2026-09-05T12:10:00.000Z") }]);
		await expect(foreign.reader.lastActivity(_COMMAND)).rejects.toThrow("crossed its lease fence");
	});

	it("derives the same active-turn stream the turn store reads for the lease", async function _StreamParity()
	{
		const read: string[] = [];
		const history = { append: vi.fn(), readStream: vi.fn(async function* _Empty(request: { readonly streamName: string }) { read.push(request.streamName); yield* []; }) };
		await expect(new KurrentConversationComputerTurnStore(history as never).loadActive(_COMMAND)).resolves.toBeNull();
		expect(read).toEqual([_ConversationComputerActiveTurnStreamName(_COMMAND)]);
	});
});
