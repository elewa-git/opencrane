import { afterEach, describe, expect, it, vi } from "vitest";

import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { ConversationComputerExecutionStartOutcomes, ConversationComputerSandboxReconciliationOutcomes } from "@opencrane/backend/server/conversations";

import { _StartConversationComputerSandboxReconciliationWorker } from "../conversation-computer-sandbox-reconciliation-composition";

/** Holds the close signal that lets the fake regular stream stop only after worker shutdown. */
const _stream = vi.hoisted(function _Stream()
{
	let close: (() => void) | undefined;
	return {
		close: function _Close() { close?.(); },
		events: (async function* _Events()
		{
			yield { id: "activation-1", streamName: "computer-activations-testv5", type: "opencrane.computer.activation-requested.v1", data: { siloId: "testv5", computerId: "computer-1", conversationId: "conversation-1", generation: 2 }, metadata: {}, revision: 0n, recordedAt: new Date("2026-09-01T00:00:00.000Z") };
			await new Promise<void>(function _Wait(resolve) { close = resolve; });
		})(),
	};
});

vi.mock("../log", function _Log()
{
	return { _log: { error: vi.fn(), fatal: vi.fn(), warn: vi.fn() } };
});

/** Builds a server-owned execution-start port that never lets the worker choose execution facts. */
function _Executions()
{
	return { start: vi.fn().mockResolvedValue({ outcome: ConversationComputerExecutionStartOutcomes.Started, execution: { id: "execution-1" } }) };
}

/** Builds a target input dispatcher that records backlog dispatches after execution starts. */
function _Inputs()
{
	return { dispatch: vi.fn().mockResolvedValue({ dispatchedInputCount: 0 }) };
}

describe("ConversationComputer sandbox reconciliation composition", function _ReconciliationCompositionSuite()
{
	afterEach(function _RestoreTimers()
	{
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("replays the activation stream and stops status polling before its HistoryStore subscription", async function _ReplaysDurableActivations()
	{
		vi.useFakeTimers();
		const subscription = { events: _stream.events, close: vi.fn(async function _Close() { _stream.close(); }) };
		const subscribe = vi.fn().mockResolvedValue(subscription);
		const authority = { reconcile: vi.fn().mockResolvedValue("warmed") };
		const executions = _Executions();
		const inputs = _Inputs();
		const worker = await _StartConversationComputerSandboxReconciliationWorker({ subscribe } as unknown as HistoryStore, authority as never, executions as never, inputs as never, "testv5");

		expect(subscribe).toHaveBeenCalledWith({ streamName: "computer-activations-testv5", fromRevision: 0n });
		await vi.advanceTimersByTimeAsync(1_000);
		expect(authority.reconcile).toHaveBeenCalledWith({ siloId: "testv5", computerId: "computer-1", conversationId: "conversation-1", generation: 2 });
		expect(executions.start).toHaveBeenCalledWith({ siloId: "testv5", computerId: "computer-1", conversationId: "conversation-1", generation: 2 });
		expect(inputs.dispatch).toHaveBeenCalledWith({ siloId: "testv5", conversationId: "conversation-1", computerId: "computer-1" });

		await worker.stop();
		expect(subscription.close).toHaveBeenCalledOnce();
	});

	it("recovers execution admission from an already warm exact generation after a restart", async function _RecoversWarmExecutionAdmission()
	{
		vi.useFakeTimers();
		let resolveStream: () => void;
		const streamClosed = new Promise<void>(function _CreateStreamClose(resolve) { resolveStream = resolve; });
		const events = (async function* _Events()
		{
			yield { id: "activation-recovery", streamName: "computer-activations-testv5", type: "opencrane.computer.activation-requested.v1", data: { siloId: "testv5", computerId: "computer-1", conversationId: "conversation-1", generation: 2 }, metadata: {}, revision: 1n, recordedAt: new Date("2026-09-01T00:00:00.000Z") };
			await streamClosed;
		})();
		const subscription = { events, close: vi.fn(async function _Close() { resolveStream(); }) };
		const authority = { reconcile: vi.fn().mockResolvedValue(ConversationComputerSandboxReconciliationOutcomes.ExecutionPending) };
		const executions = _Executions();
		const worker = await _StartConversationComputerSandboxReconciliationWorker({ subscribe: vi.fn().mockResolvedValue(subscription) } as unknown as HistoryStore, authority as never, executions as never, _Inputs() as never, "testv5");

		await vi.advanceTimersByTimeAsync(1_000);
		expect(executions.start).toHaveBeenCalledWith({ siloId: "testv5", computerId: "computer-1", conversationId: "conversation-1", generation: 2 });

		await worker.stop();
	});

	it("retries a transient execution-admission failure against the same warm generation", async function _RetriesExecutionAdmission()
	{
		vi.useFakeTimers();
		let resolveStream: () => void;
		const streamClosed = new Promise<void>(function _CreateStreamClose(resolve) { resolveStream = resolve; });
		const events = (async function* _Events()
		{
			yield { id: "activation-retry", streamName: "computer-activations-testv5", type: "opencrane.computer.activation-requested.v1", data: { siloId: "testv5", computerId: "computer-1", conversationId: "conversation-1", generation: 2 }, metadata: {}, revision: 1n, recordedAt: new Date("2026-09-01T00:00:00.000Z") };
			await streamClosed;
		})();
		const subscription = { events, close: vi.fn(async function _Close() { resolveStream(); }) };
		const authority = { reconcile: vi.fn().mockResolvedValueOnce(ConversationComputerSandboxReconciliationOutcomes.Warmed).mockResolvedValueOnce(ConversationComputerSandboxReconciliationOutcomes.ExecutionPending) };
		const executions = { start: vi.fn().mockRejectedValueOnce(new Error("temporary history error")).mockResolvedValueOnce({ outcome: ConversationComputerExecutionStartOutcomes.Started, execution: { id: "execution-1" } }) };
		const worker = await _StartConversationComputerSandboxReconciliationWorker({ subscribe: vi.fn().mockResolvedValue(subscription) } as unknown as HistoryStore, authority as never, executions as never, _Inputs() as never, "testv5");

		await vi.advanceTimersByTimeAsync(1_000);
		await vi.advanceTimersByTimeAsync(1_000);
		expect(executions.start).toHaveBeenCalledTimes(2);

		await worker.stop();
	});

	it("waits for an in-flight status pass before its HistoryStore subscription can close", async function _DrainsStatusPass()
	{
		vi.useFakeTimers();
		let resolveStream: () => void;
		let resolvePass: (() => void) | undefined;
		const streamClosed = new Promise<void>(function _CreateStreamClose(resolve) { resolveStream = resolve; });
		const events = (async function* _Events()
		{
			yield { id: "activation-2", streamName: "computer-activations-testv5", type: "opencrane.computer.activation-requested.v1", data: { siloId: "testv5", computerId: "computer-2", conversationId: "conversation-1", generation: 3 }, metadata: {}, revision: 1n, recordedAt: new Date("2026-09-01T00:00:00.000Z") };
			await streamClosed;
		})();
		const subscription = { events, close: vi.fn(async function _Close() { resolveStream(); }) };
		const authority = { reconcile: vi.fn().mockImplementation(async function _Reconcile() { await new Promise<void>(function _Wait(resolve) { resolvePass = resolve; }); return "pending"; }) };
		const worker = await _StartConversationComputerSandboxReconciliationWorker({ subscribe: vi.fn().mockResolvedValue(subscription) } as unknown as HistoryStore, authority as never, _Executions() as never, _Inputs() as never, "testv5");

		await vi.advanceTimersByTimeAsync(1_000);
		const stopping = worker.stop();
		let stopped = false;
		void stopping.then(function _Stopped() { stopped = true; });
		await Promise.resolve();
		expect(stopped).toBe(false);
		resolvePass?.();
		await stopping;
		expect(subscription.close).toHaveBeenCalledOnce();
	});

	it("rotates past pending activation races so a later dispatched claim cannot starve", async function _RotatesPendingLocators()
	{
		vi.useFakeTimers();
		let resolveStream: () => void;
		const streamClosed = new Promise<void>(function _CreateStreamClose(resolve) { resolveStream = resolve; });
		const events = (async function* _Events()
		{
			for (let index = 1; index <= 9; index += 1)
				yield { id: `activation-${index}`, streamName: "computer-activations-testv5", type: "opencrane.computer.activation-requested.v1", data: { siloId: "testv5", computerId: `computer-${index}`, conversationId: "conversation-1", generation: 1 }, metadata: {}, revision: BigInt(index), recordedAt: new Date("2026-09-01T00:00:00.000Z") };
			await streamClosed;
		})();
		const subscription = { events, close: vi.fn(async function _Close() { resolveStream(); }) };
		const authority = { reconcile: vi.fn(async function _Reconcile(command: { readonly computerId: string }) { return command.computerId === "computer-9" ? ConversationComputerSandboxReconciliationOutcomes.Warmed : ConversationComputerSandboxReconciliationOutcomes.Pending; }) };
		const executions = _Executions();
		const worker = await _StartConversationComputerSandboxReconciliationWorker({ subscribe: vi.fn().mockResolvedValue(subscription) } as unknown as HistoryStore, authority as never, executions as never, _Inputs() as never, "testv5");

		await vi.advanceTimersByTimeAsync(1_000);
		expect(authority.reconcile).not.toHaveBeenCalledWith(expect.objectContaining({ computerId: "computer-9" }));
		await vi.advanceTimersByTimeAsync(1_000);
		expect(authority.reconcile).toHaveBeenCalledWith(expect.objectContaining({ computerId: "computer-9" }));
		expect(executions.start).toHaveBeenCalledWith(expect.objectContaining({ computerId: "computer-9" }));

		await worker.stop();
	});
});
