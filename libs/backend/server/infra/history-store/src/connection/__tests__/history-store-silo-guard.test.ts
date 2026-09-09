import { describe, expect, it, vi } from "vitest";

import { HistoryExpectedRevisions, type HistoryRecordedEvent } from "../../history-store.types";

import { _AssertHistoryStoreSilo, _SILO_SENTINEL_STREAM } from "../history-store-silo-guard";

/** Turns a finite test sequence into the HistoryStore stream read contract. */
async function *_Events(events: readonly HistoryRecordedEvent[]): AsyncIterable<HistoryRecordedEvent>
{
	for (const event of events)
		yield event;
}

/** Builds one recorded sentinel event the way the guard writes it. */
function _Sentinel(siloId: string, type: string = "opencrane.silo.v1"): HistoryRecordedEvent
{
	return { id: "00000000-0000-4000-8000-000000000001", type, data: { siloId }, metadata: { siloId }, streamName: _SILO_SENTINEL_STREAM, revision: 0n, recordedAt: new Date("2026-09-06T10:00:00.000Z") };
}

describe("_AssertHistoryStoreSilo", function _Suite()
{
	it("records the silo id once, fenced to stream creation, when no sentinel exists", async function _Records()
	{
		const append = vi.fn().mockResolvedValue({ streamName: _SILO_SENTINEL_STREAM, revision: 0n });
		const readStream = vi.fn().mockReturnValue(_Events([]));

		await expect(_AssertHistoryStoreSilo({ append, readStream }, "silo-a")).resolves.toBeUndefined();

		expect(readStream).toHaveBeenCalledWith({ streamName: _SILO_SENTINEL_STREAM });
		expect(append).toHaveBeenCalledOnce();
		const command = append.mock.calls[0]![0];
		expect(command.streamName).toBe(_SILO_SENTINEL_STREAM);
		expect(command.expectedRevision).toBe(HistoryExpectedRevisions.NoStream);
		expect(command.events).toHaveLength(1);
		expect(command.events[0]).toMatchObject({ type: "opencrane.silo.v1", data: { siloId: "silo-a" }, metadata: { siloId: "silo-a" } });
		expect(command.events[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
	});

	it("starts without writing when the sentinel already names this silo", async function _Idempotent()
	{
		const append = vi.fn();
		const readStream = vi.fn().mockReturnValue(_Events([_Sentinel("silo-a")]));

		await expect(_AssertHistoryStoreSilo({ append, readStream }, "silo-a")).resolves.toBeUndefined();

		expect(append).not.toHaveBeenCalled();
	});

	it("refuses to start when the sentinel names another silo", async function _Refuses()
	{
		const append = vi.fn();
		const readStream = vi.fn().mockReturnValue(_Events([_Sentinel("silo-a")]));

		await expect(_AssertHistoryStoreSilo({ append, readStream }, "silo-b")).rejects.toThrow("already belongs to silo silo-a; this server is configured for silo silo-b");

		expect(append).not.toHaveBeenCalled();
	});

	it("accepts a racing replica that wrote the same silo first and rejects one that wrote another", async function _Race()
	{
		const conflict = new Error("WrongExpectedVersion");
		const sameSilo = { append: vi.fn().mockRejectedValue(conflict), readStream: vi.fn().mockReturnValueOnce(_Events([])).mockReturnValueOnce(_Events([_Sentinel("silo-a")])) };
		await expect(_AssertHistoryStoreSilo(sameSilo, "silo-a")).resolves.toBeUndefined();
		expect(sameSilo.readStream).toHaveBeenCalledTimes(2);

		const otherSilo = { append: vi.fn().mockRejectedValue(conflict), readStream: vi.fn().mockReturnValueOnce(_Events([])).mockReturnValueOnce(_Events([_Sentinel("silo-b")])) };
		await expect(_AssertHistoryStoreSilo(otherSilo, "silo-a")).rejects.toThrow("already belongs to silo silo-b");

		const unavailable = { append: vi.fn().mockRejectedValue(conflict), readStream: vi.fn().mockReturnValue(_Events([])) };
		await expect(_AssertHistoryStoreSilo(unavailable, "silo-a")).rejects.toBe(conflict);
	});

	it("fails closed on a malformed sentinel or a missing silo id", async function _FailsClosed()
	{
		const append = vi.fn();
		await expect(_AssertHistoryStoreSilo({ append, readStream: vi.fn().mockReturnValue(_Events([_Sentinel("silo-a", "opencrane.other.v1")])) }, "silo-a")).rejects.toThrow("malformed silo sentinel");
		await expect(_AssertHistoryStoreSilo({ append, readStream: vi.fn().mockReturnValue(_Events([{ ..._Sentinel("silo-a"), data: {} }])) }, "silo-a")).rejects.toThrow("malformed silo sentinel");
		await expect(_AssertHistoryStoreSilo({ append, readStream: vi.fn() }, "")).rejects.toThrow("requires a configured silo id");
		expect(append).not.toHaveBeenCalled();
	});
});
