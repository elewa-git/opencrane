import { describe, expect, it } from "vitest";

import { _OutputRecoveryHarness } from "./conversation-output-recovery.fixture";
import { _PrepareConversationOutputIntent } from "./conversation-output-intent.fixture";

/** Coordinate genuinely concurrent preparations before either checked turn decision can commit. */
function _Gate()
{
	let release!: () => void;
	const promise = new Promise<void>(function _Wait(resolve) { release = resolve; });
	return { promise, release };
}

describe("chosen answer recovery across fresh server instances", function _Suite()
{
	it.each(["intent", "history", "complete", "revoke", "settle"])("converges after the %s response is lost", async function _RestartAfterLoss(step)
	{
		const f = await _OutputRecoveryHarness();
		let lost = false;
		f.history.afterAppend = async function _LoseResponse(command)
		{
			const type = command.events[0].type;
			if (!lost && ((step === "intent" && type.endsWith("turn-output.v2")) || (step === "history" && command.streamName === f.stream) || (step === "settle" && type.endsWith("turn-settled.v1"))))
			{
				lost = true;
				throw new Error("response lost");
			}
		};
		if (step === "complete")
		{
			const complete = f.runLifecycle.complete.getMockImplementation()!;
			f.runLifecycle.complete.mockImplementationOnce(async function _LoseCompletion() { await complete(); throw new Error("response lost"); });
		}
		if (step === "revoke")
			f.credentials.revoke.mockRejectedValueOnce(new Error("response lost"));
		await expect(f.authority.appendOutput(f.output)).rejects.toThrow("response lost");
		const saved = (await f.store.load(f.output.bootstrapId))!.outputReceipt!;
		const compilerCalls = f.compiler.compile.mock.calls.length;
		f.flags.stamp = 100;
		await expect(f.restart().bootstrap(f.command)).resolves.toBeNull();
		expect(f.history.streams.get(f.stream)!.slice(2)).toHaveLength(1);
		expect(f.history.streams.get(f.stream)![2].data).toEqual(saved.event.data);
		expect(f.flags.runState).toBe("completed");
		expect(await f.store.loadActive({ siloId: "silo-1", computerId: f.command.computerId, lease: f.command.lease })).toBeNull();
		expect(f.credentials.issueOnce).not.toHaveBeenCalled();
		expect(f.flags.payloadWrites).toBe(1);
		expect(f.outputPayloads.store).toHaveBeenCalledOnce();
		if (step !== "intent" && step !== "settle")
			expect(f.compiler.compile).toHaveBeenCalledTimes(compilerCalls);
		expect(JSON.stringify(saved)).not.toContain(f.output.text);
	});

	it("rejects changed text on an explicit retry and recovers the unchanged answer without another payload", async function _ChangedText()
	{
		const f = await _OutputRecoveryHarness();
		await f.authority.appendOutput(f.output);
		await expect(f.restart().appendOutput({ ...f.output, text: "A changed answer" })).rejects.toThrow("different text");
		await expect(f.restart().appendOutput(f.output)).resolves.toBe("idempotent");
		expect(f.history.streams.get(f.stream)!).toHaveLength(3);
		expect(f.flags.payloadWrites).toBe(1);
	});

	it("uses the elected timestamp when two identical outputs prepare concurrently", async function _ConcurrentPreparation()
	{
		const f = await _OutputRecoveryHarness();
		const ready = _Gate();
		let arrived = 0;
		f.history.beforeAppend = async function _BothPrepared(command)
		{
			if (!command.events[0].type.endsWith("turn-output.v2"))
				return;
			if (++arrived === 2)
				ready.release();
			await ready.promise;
		};
		await Promise.all([f.authority.appendOutput(f.output), f.restart().appendOutput(f.output)]);
		expect(f.flags.stamp).toBe(2);
		const saved = (await f.store.load(f.output.bootstrapId))!.outputReceipt!;
		expect(f.history.streams.get(f.stream)!.slice(2)).toHaveLength(1);
		expect(f.history.streams.get(f.stream)![2].data).toEqual(saved.event.data);
		expect(f.flags.payloadWrites).toBe(1);
	});

	it("keeps a newer active turn intact when an older completed answer is retried", async function _OldAnswerRetry()
	{
		const f = await _OutputRecoveryHarness();
		await f.authority.appendOutput(f.output);
		const first = (await f.store.load(f.output.bootstrapId))!;
		const next = { ...first, bootstrapId: "8957851b-21c1-4890-ae32-fb6de5224f2d", latestPendingEntryId: "next-human", outputReceipt: null, outputSourceCommandId: null, binding: { ...first.binding, expectedRevision: 3n, runId: "next-run" }, compile: { ...first.compile, runId: "next-run" } };
		await f.store.createOrRead(next);
		let settlementAppends = 0;
		f.history.beforeAppend = async function _Count(command)
		{
			if (command.events[0].type.endsWith("turn-settled.v1"))
				settlementAppends++;
		};
		await expect(f.restart().appendOutput(f.output)).resolves.toBe("idempotent");
		expect(settlementAppends).toBe(0);
		expect((await f.store.loadActive(next))?.bootstrapId).toBe(next.bootstrapId);
		expect(f.history.streams.get(f.stream)!).toHaveLength(3);
	});

	it.each(["authority", "visibility", "lease", "pod"])("refuses a missing output after %s is lost", async function _NoNewAppendWithoutAuthority(kind)
	{
		const f = await _OutputRecoveryHarness();
		f.history.afterAppend = async function _StopAfterIntent(command)
		{
			if (command.events[0].type.endsWith("turn-output.v2"))
				throw new Error("intent saved");
		};
		await expect(f.authority.appendOutput(f.output)).rejects.toThrow("intent saved");
		if (kind === "authority")
			f.flags.mayAppend = false;
		if (kind === "visibility")
			f.flags.mayUseVisibility = false;
		if (kind === "lease")
			f.current.lease.expiresAt = "2000-01-01T00:00:00.000Z";
		const command = kind === "pod" ? { ...f.command, workload: { ...f.command.workload, podUid: "foreign-pod" } } : f.command;
		await expect(f.restart().bootstrap(command)).rejects.toThrow();
		expect(f.history.streams.get(f.stream)!).toHaveLength(2);
		expect(f.runLifecycle.complete).not.toHaveBeenCalled();
	});

	it("refuses a wrong Pod even when its target answer is already accepted", async function _WrongRecoveryPod()
	{
		const f = await _OutputRecoveryHarness();
		f.runLifecycle.complete.mockRejectedValueOnce(new Error("completion unavailable"));
		await expect(f.authority.appendOutput(f.output)).rejects.toThrow("completion unavailable");
		await expect(f.restart().bootstrap({ ...f.command, workload: { ...f.command.workload, podUid: "foreign-pod" } })).rejects.toThrow("lease-bound Sandbox Pod");
		expect(f.credentials.revoke).not.toHaveBeenCalled();
	});

	it("recognizes its exact answer followed by later human history without consuming that input", async function _LaterHistory()
	{
		const f = await _OutputRecoveryHarness();
		f.runLifecycle.complete.mockRejectedValueOnce(new Error("completion unavailable"));
		await expect(f.authority.appendOutput(f.output)).rejects.toThrow("completion unavailable");
		const events = f.history.streams.get(f.stream)!;
		events.push({ ...events[1], id: "later-human", revision: 3n });
		const calls = f.compiler.compile.mock.calls.length;
		await f.restart().bootstrap(f.command);
		expect(f.compiler.compile).toHaveBeenCalledTimes(calls);
		expect(events).toHaveLength(4);
		expect(events[3].id).toBe("later-human");
	});

	it("cannot complete over a different event occupying the target slot or a failed run", async function _Conflicts()
	{
		const f = await _OutputRecoveryHarness();
		const turn = (await f.store.load(f.output.bootstrapId))!;
		const intent = await _PrepareConversationOutputIntent(turn, f.output.sourceCommandId);
		await f.store.markOutput(turn.bootstrapId, intent);
		const events = f.history.streams.get(f.stream)!;
		events.push({ ...events[1], id: "foreign-entry", revision: 2n });
		await expect(f.restart().bootstrap(f.command)).rejects.toThrow("different history");
		expect(f.runLifecycle.complete).not.toHaveBeenCalled();
		events[2] = { ...intent.event, streamName: f.stream, revision: 2n, recordedAt: new Date() };
		f.flags.runState = "failed";
		await expect(f.restart().bootstrap(f.command)).rejects.toThrow("already failed");
		expect(f.credentials.revoke).not.toHaveBeenCalled();
	});

	it("refuses a competing history append that wins after the last read", async function _HistoryRace()
	{
		const f = await _OutputRecoveryHarness();
		f.history.beforeAppend = async function _CompetingWriter(command)
		{
			if (command.streamName === f.stream)
			{
				const events = f.history.streams.get(f.stream)!;
				events.push({ ...events[1], id: "competing-human", revision: 2n });
			}
		};
		await expect(f.authority.appendOutput(f.output)).rejects.toThrow("different history");
		expect(f.runLifecycle.complete).not.toHaveBeenCalled();
		expect(f.history.streams.get(f.stream)![2].id).toBe("competing-human");
	});

	it("keeps an accepted answer pending while exact readback is unavailable", async function _UnavailableReadback()
	{
		const f = await _OutputRecoveryHarness();
		f.history.afterAppend = async function _LoseReadback(command)
		{
			if (command.streamName === f.stream)
				f.history.beforeRead = async function _Unavailable(request)
				{
					if (request.streamName === f.stream)
						throw new Error("history read unavailable");
				};
		};
		await expect(f.authority.appendOutput(f.output)).rejects.toThrow("history read unavailable");
		expect(f.runLifecycle.complete).not.toHaveBeenCalled();
		f.history.beforeRead = async function _Restored() {};
		await f.restart().bootstrap(f.command);
		expect(f.history.streams.get(f.stream)!).toHaveLength(3);
	});

});
