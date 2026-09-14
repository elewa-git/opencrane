import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationModelResponseKinds, ConversationModelToolModes, ConversationToolProposalOutcomes } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { _ToolContinuationHarness } from "./conversation-tool-continuation.fixture";
import { ConversationComputerToolResultOutcomes } from "../conversation-computer-continuation.types";
import type { FrozenConversationComputerTurn } from "../conversation-computer-turn.types";
import { ConversationToolProposalRefusal } from "../../tools/proposal/conversation-tool-proposal-refusal";
import { ConversationToolProposalRefusals } from "../../tools/proposal/conversation-tool-proposal.types";

afterEach(() => { vi.restoreAllMocks(); });

/** Pause at an actual durable boundary while another server handler reaches the same state. */
function _Barrier()
{
	let release!: () => void;
	const promise = new Promise<void>(resolve => { release = resolve; });
	return { promise, release };
}

function _CurrentSelection(turn: FrozenConversationComputerTurn)
{
	const selection = turn.protocol.steps.at(-1)?.selection;
	if (selection === null || selection === undefined)
		throw new Error("Expected the current ordered step to have a selection");
	return selection;
}

function _LastSelection(turn: FrozenConversationComputerTurn)
{
	return turn.protocol.steps.at(-1)?.selection ?? [...turn.protocol.steps].reverse().find(step => step.result !== null)?.selection ?? _CurrentSelection(turn);
}

function _LastResult(turn: FrozenConversationComputerTurn)
{
	const step = [...turn.protocol.steps].reverse().find(candidate => candidate.result !== null);
	if (step === undefined || step.result === null)
		throw new Error("Expected a saved ordered result");
	return step.result;
}

describe("one governed tool and its model continuation", function _Continuation()
{
	it("keeps original input and exact tool-call pairing, spends one shared allowance and posts one final answer", async function _Answer()
	{
		const f = await _ToolContinuationHarness();
		expect(await f.authority.advance(f.step)).toEqual({ outcome: "completed" });
		expect(f.model.request).toHaveBeenCalledTimes(2);
		const [first, second] = f.model.request.mock.calls.map(call => call[0]);
		expect(first).toMatchObject({ tools: ConversationModelToolModes.Select, maxCompletionTokens: 50, history: [] });
		expect(second).toMatchObject({ tools: ConversationModelToolModes.None, maxCompletionTokens: 50, history: [{ call: f.call }] });
		expect(second.history[0].resultContent).toContain("private-result");
		expect(second.compiledInput).toEqual(first.compiledInput);
		expect(second.key).toBe(first.key);
		expect(f.credentials.issueOnce).toHaveBeenCalledOnce();
		expect(f.credentials.reuseExact).toHaveBeenCalledOnce();
		expect(f.requestedNotifications.publishRequested).toHaveBeenCalledWith(expect.objectContaining({ bootstrapId: f.step, toolInvocationId: expect.any(String) }));
		expect(f.proposals.admit.mock.invocationCallOrder[0]).toBeLessThan(f.requestedNotifications.publishRequested.mock.invocationCallOrder[0]!);
		expect(f.requestedNotifications.publishRequested.mock.invocationCallOrder[0]).toBeLessThan(f.results.read.mock.invocationCallOrder[0]!);
		expect(f.toolFlags).toMatchObject({ executions: 1, acknowledgements: 1, consumed: true });
		const turn = (await f.store.load(f.step))!;
		expect(turn.protocol.steps[0]?.selection).not.toBeNull();
		expect(turn.protocol.accounting.reservedModelCalls).toBe(2);
		expect(turn.protocol.steps.at(-1)?.reservation.ordinal).toBe(2);
		expect(turn.protocol.steps.at(-1)?.reservation.invocationFence).not.toBe(turn.protocol.steps[0]?.reservation.invocationFence);
		expect(f.history.streams.get(f.stream)).toHaveLength(3);
		const stored = JSON.stringify([...f.history.streams.values()], (_key, value) => typeof value === "bigint" ? String(value) : value);
		for (const secret of ["private-query", "private-result", "Private assistant declaration", "test-only-key"])
			expect(stored).not.toContain(secret);
		expect(f.rows.size).toBe(2);
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "completed" });
		expect(f.model.request).toHaveBeenCalledTimes(2);
	});

	it("recovers committed declaration custody after response loss and after the first dispatch window", async function _DeclarationCustody()
	{
		let now = Date.now();
		vi.spyOn(Date, "now").mockImplementation(() => now);
		const f = await _ToolContinuationHarness();
		const store = f.custody.storeDeclaration.bind(f.custody);
		vi.spyOn(f.custody, "storeDeclaration").mockImplementationOnce(async function _LostReply(turn, declaration)
		{
			await store(turn, declaration);
			throw new Error("custody response lost");
		});
		expect(await f.authority.advance(f.step)).toMatchObject({ outcome: "model_pending" });
		expect((await f.store.load(f.step))?.protocol.steps.at(-1)?.selection).toBeNull();
		now += 40_000;
		expect(await f.restart().start(f.workflowCommand)).toMatchObject({ bootstrapId: f.step });
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "completed" });
		expect(f.model.request).toHaveBeenCalledTimes(2);
		expect(f.credentials.issueOnce).toHaveBeenCalledOnce();
		expect(f.toolFlags.executions).toBe(1);
	});

	it.each([false, true])("recovers a tool selection failure before or after its append: %s", async function _SelectionCrash(after)
	{
		const f = await _ToolContinuationHarness();
		let failed = false;
		const fault = async function _Fault(command: any)
		{
			if (!failed && command.events[0].type.includes("tool-selected"))
			{
				failed = true;
				throw new Error("selection response lost");
			}
		};
		if (after)
			f.history.afterAppend = fault;
		else
			f.history.beforeAppend = fault;
		expect(await f.authority.advance(f.step)).toMatchObject({ outcome: after ? "retry" : "model_pending" });
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "completed" });
		expect(f.model.request).toHaveBeenCalledTimes(2);
		expect(f.toolFlags.executions).toBe(1);
	});

	it("recovers an admitted tool after a lost SQL reply without creating another execution", async function _AdmissionCrash()
	{
		const f = await _ToolContinuationHarness();
		const admit = f.proposals.admit.getMockImplementation()!;
		f.proposals.admit.mockImplementationOnce(async function _LostReply(turn)
		{
			await admit(turn);
			throw new Error("admission response lost");
		});
		expect(await f.authority.advance(f.step)).toEqual({ outcome: "retry" });
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "completed" });
		expect(f.toolFlags.executions).toBe(1);
		expect(f.model.request).toHaveBeenCalledTimes(2);
	});

	it("publishes no requested fact when proposal admission refuses", async function _AdmissionRefusal()
	{
		const f = await _ToolContinuationHarness();
		f.proposals.admit.mockRejectedValue(new Error("proposal refused"));
		expect(await f.authority.advance(f.step)).toEqual({ outcome: "retry" });
		expect(f.requestedNotifications.publishRequested).not.toHaveBeenCalled();
		expect(f.results.read).not.toHaveBeenCalled();
	});

	it("durably closes a selected proposal after a deterministic refusal", async function _DeterministicRefusal()
	{
		const f = await _ToolContinuationHarness();
		f.proposals.admit.mockRejectedValue(new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Denied));
		expect(await f.authority.advance(f.step)).toEqual({ outcome: "response_unavailable" });
		expect((await f.store.load(f.step))?.protocol.unavailable?.reason).toBe("tool_result_unavailable");
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "response_unavailable" });
		expect(f.requestedNotifications.publishRequested).not.toHaveBeenCalled();
	});

	it("does not poll a result when requested history loses current authority", async function _RequestedRefused()
	{
		const f = await _ToolContinuationHarness();
		f.requestedNotifications.publishRequested.mockResolvedValue("no_longer_visible");
		expect(await f.authority.advance(f.step)).toEqual({ outcome: "authority_ended" });
		expect(f.proposals.admit).toHaveBeenCalledOnce();
		expect(f.results.read).not.toHaveBeenCalled();
	});

	it("waits on pending tool work past the first response deadline without replaying the model or key", async function _PendingTool()
	{
		let now = Date.now();
		vi.spyOn(Date, "now").mockImplementation(() => now);
		const f = await _ToolContinuationHarness();
		f.toolFlags.pending = true;
		expect(await f.authority.advance(f.step)).toEqual({ outcome: "tool_pending", toolInvocationId: expect.any(String) });
		now += 40_000;
		expect(await f.restart().start(f.workflowCommand)).toMatchObject({ bootstrapId: f.step });
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "tool_pending", toolInvocationId: expect.any(String) });
		expect(f.model.request).toHaveBeenCalledOnce();
		f.toolFlags.pending = false;
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "completed" });
		expect(f.credentials.issueOnce).toHaveBeenCalledOnce();
		expect(f.toolFlags.executions).toBe(1);
	});

	it("durably closes a saved selection when its tool preparation expires", async function _PreparationRefusal()
	{
		let now = Date.now();
		vi.spyOn(Date, "now").mockImplementation(() => now);
		const f = await _ToolContinuationHarness();
		f.toolFlags.pending = true;
		expect(await f.authority.advance(f.step)).toMatchObject({ outcome: "tool_pending" });
		f.toolFlags.pending = false;
		now = f.candidate.compiledInput.budget.wallClockDeadlineEpochMs + 1;
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "response_unavailable" });
		expect((await f.store.load(f.step))?.protocol.unavailable?.reason).toBe("tool_result_unavailable");
		expect(f.runLifecycle.enterRecoveryRequired).toHaveBeenCalledOnce();
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "response_unavailable" });
		expect(f.model.request).toHaveBeenCalledOnce();
	});

	it("pauses an approval proposal, admits exactly once after the owner decision, and replays safely", async function _ApprovalReplay()
	{
		const f = await _ToolContinuationHarness();
		Object.assign(f.candidate.compiledInput.tools[0], { requiresApproval: true });
		let decision: "awaiting" | "ready" = "awaiting";
		f.proposals.admit.mockImplementation(async function _Admit(turn)
		{
			if (decision === "ready")
				f.toolFlags.executions++;
			return { proposalId: _CurrentSelection(turn).proposalId, outcome: ConversationToolProposalOutcomes.Existing };
		});
		f.results.read.mockImplementation(async function _Read(turn)
		{
			if (decision === "awaiting")
				return { outcome: ConversationComputerToolResultOutcomes.Pending, waitFor: "approval", waitUntilEpochMs: Date.now() + 60_000 } as const;
			const payload = { toolInvocationId: _LastSelection(turn).toolInvocationId, outcome: "succeeded" as const, result: { record: "private-result-1" } };
			return { outcome: ConversationComputerToolResultOutcomes.Available, payload, payloadDigest: ___DigestCanonicalJson(payload), toolRevisionId: "tool-1", occurredAt: "2026-09-11T10:00:00.000Z", notAfterEpochMs: Date.now() + 60_000 } as const;
		});

		expect(await f.authority.advance(f.step)).toMatchObject({ outcome: "tool_pending", waitFor: "approval" });
		expect(f.toolFlags.executions).toBe(0);
		decision = "ready";
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "completed" });
		expect(f.toolFlags.executions).toBe(1);
		expect(f.model.request).toHaveBeenCalledTimes(2);
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "completed" });
		expect(f.toolFlags.executions).toBe(1);
	});

	it("leaves a denied approval terminal without admitting an external executor", async function _DeniedApproval()
	{
		const f = await _ToolContinuationHarness();
		Object.assign(f.candidate.compiledInput.tools[0], { requiresApproval: true });
		let denied = false;
		f.proposals.admit.mockImplementation(async function _Admit(turn) { return { proposalId: _CurrentSelection(turn).proposalId, outcome: ConversationToolProposalOutcomes.Existing }; });
		f.results.read.mockImplementation(async function _Read()
		{
			return denied ? { outcome: ConversationComputerToolResultOutcomes.Unavailable } as const : { outcome: ConversationComputerToolResultOutcomes.Pending, waitFor: "approval" } as const;
		});
		expect(await f.authority.advance(f.step)).toMatchObject({ outcome: "tool_pending", waitFor: "approval" });
		denied = true;
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "response_unavailable" });
			expect(f.toolFlags.executions).toBe(0);
		expect((await f.store.load(f.step))?.protocol.unavailable?.reason).toBe("tool_result_unavailable");
	});

	it("recovers exact continuation custody after its response is lost before reservation", async function _ContinuationCustody()
	{
		const f = await _ToolContinuationHarness();
		const store = f.custody.storeExchange.bind(f.custody);
		vi.spyOn(f.custody, "storeExchange").mockImplementationOnce(async function _LostReply(turn, exchange)
		{
			await store(turn, exchange);
			throw new Error("exchange custody response lost");
		});
		expect(await f.authority.advance(f.step)).toEqual({ outcome: "retry" });
		expect((await f.store.load(f.step))?.protocol.steps.at(-1)?.result).toBeNull();
		expect(f.toolFlags.consumed).toBe(false);
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "completed" });
		expect(f.model.request).toHaveBeenCalledTimes(2);
	});

	it.each(["reservation", "acknowledgement", "response"])("never adopts a second paid reservation after lost %s", async function _NoReplay(boundary)
	{
		let now = Date.now();
		vi.spyOn(Date, "now").mockImplementation(() => now);
		const f = await _ToolContinuationHarness();
		if (boundary === "reservation")
			f.history.afterAppend = async function _LostReservation(command)
			{
				if ((command.events[0].data["reservation"] as any)?.ordinal === 2)
					throw new Error("reservation response lost");
			};
		if (boundary === "acknowledgement")
		{
			const consume = f.results.consume.getMockImplementation()!;
			f.results.consume.mockImplementationOnce(async function _LostAcknowledgement(turn)
			{
				await consume(turn);
				throw new Error("acknowledgement response lost");
			});
		}
		if (boundary === "response")
			f.model.request.mockResolvedValueOnce({ kind: ConversationModelResponseKinds.Tool, call: f.call }).mockRejectedValueOnce(new Error("paid response lost"));
		expect(await f.authority.advance(f.step)).toMatchObject({ outcome: "model_pending" });
		const reservedTurn = (await f.store.load(f.step))!;
		const reservation = reservedTurn.protocol.steps.at(-1)?.reservation;
		expect(reservation).not.toBeNull();
		now += 30_000;
		f.runLifecycle.enterRecoveryRequired.mockRejectedValueOnce(new Error("run recovery write unavailable"));
		await expect(f.restart().advance(f.step)).rejects.toThrow("run recovery write unavailable");
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "response_unavailable" });
		expect(f.runLifecycle.enterRecoveryRequired).toHaveBeenCalledTimes(2);
		expect(f.runLifecycle.complete).not.toHaveBeenCalled();
		expect((await f.store.load(f.step))!.protocol.steps.at(-1)?.reservation).toEqual(reservation);
		expect(f.model.request).toHaveBeenCalledTimes(boundary === "response" ? 2 : 1);
		expect(f.credentials.issueOnce).toHaveBeenCalledOnce();
		expect(f.toolFlags.executions).toBe(1);
		expect(f.toolFlags.acknowledgements).toBe(boundary === "reservation" ? 0 : 1);
	});

	it("lets one concurrent live handler reserve the post-tool request", async function _ConcurrentContinuation()
	{
		const f = await _ToolContinuationHarness();
		let prepared = false;
		f.history.beforeAppend = async function _BeforeReservation(command)
		{
			if (!prepared && (command.events[0].data["reservation"] as any)?.ordinal === 2)
			{
				prepared = true;
				throw new Error("stop after continuation custody");
			}
		};
		expect(await f.authority.advance(f.step)).toEqual({ outcome: "retry" });
		const barrier = _Barrier();
		let arrivals = 0;
		f.history.beforeAppend = async function _Race(command)
		{
			if ((command.events[0].data["reservation"] as any)?.ordinal === 2)
			{
				arrivals++;
				if (arrivals === 2)
					barrier.release();
				await barrier.promise;
			}
		};
		const outcomes = await Promise.all([f.restart().advance(f.step), f.restart().advance(f.step)]);
		expect(outcomes.filter(result => result.outcome === "completed")).toHaveLength(1);
		expect(f.model.request).toHaveBeenCalledTimes(2);
		expect(f.toolFlags).toMatchObject({ executions: 1, acknowledgements: 1 });
	});

	it.each([false, true])("recovers only an atomically committed final answer after tool authority ends: already accepted %s", async function _RevokedSavedAnswer(accepted)
	{
		const f = await _ToolContinuationHarness();
		let failed = false;
		if (accepted)
			f.history.afterAppend = async function _LostHistoryReply(command)
			{
				if (!failed && command.streamName === f.stream)
				{
					failed = true;
					throw new Error("history response lost");
				}
			};
		else
			f.history.beforeAppend = async function _UnwrittenHistory(command)
			{
				if (!failed && command.streamName === f.stream)
				{
					failed = true;
					throw new Error("history unavailable before append");
				}
			};
		expect(await f.authority.advance(f.step)).toMatchObject({ outcome: accepted ? "retry" : "model_pending" });
		expect(f.runLifecycle.enterRecoveryRequired).not.toHaveBeenCalled();
		expect((await f.store.load(f.step))?.protocol.output === null).toBe(!accepted);
		f.toolFlags.allowed = false;
		if (accepted)
			await expect(f.restart().start(f.workflowCommand)).resolves.toBeNull();
		else
		{
			const pending = await f.restart().advance(f.step);
			expect(pending).toMatchObject({ outcome: "model_pending", ordinal: 2 });
			if (pending.outcome !== "model_pending")
				throw new Error("Expected the saved continuation reservation to remain pending");
			vi.spyOn(Date, "now").mockReturnValue(pending.notBeforeEpochMs + 1);
			await expect(f.restart().advance(f.step)).resolves.toEqual({ outcome: "response_unavailable" });
		}
		expect(f.history.streams.get(f.stream)).toHaveLength(accepted ? 3 : 2);
		expect(f.model.request).toHaveBeenCalledTimes(2);
	});

	it("refuses a final answer when the selected grant ends during call two", async function _RevokedDuringCall()
	{
		const f = await _ToolContinuationHarness();
		f.model.request.mockResolvedValueOnce({ kind: ConversationModelResponseKinds.Tool, call: f.call }).mockImplementationOnce(async function _Revoke()
		{
			f.toolFlags.allowed = false;
			return { kind: ConversationModelResponseKinds.Text, text: "A private chosen answer" };
		});
		expect(await f.authority.advance(f.step)).toMatchObject({ outcome: "model_pending" });
		expect((await f.store.load(f.step))?.protocol.output).toBeNull();
		expect(f.history.streams.get(f.stream)).toHaveLength(2);
	});

	it("refuses a second tool declaration and never admits a second execution", async function _NoSecondTool()
	{
		const f = await _ToolContinuationHarness();
		f.model.request.mockResolvedValue({ kind: ConversationModelResponseKinds.Tool, call: f.call });
		expect(await f.authority.advance(f.step)).toMatchObject({ outcome: "model_pending" });
		expect(f.toolFlags.executions).toBe(1);
		expect(f.model.request).toHaveBeenCalledTimes(2);
		expect((await f.store.load(f.step))?.protocol.output).toBeNull();
	});

	it("rejects a repeated provider call id before the next tool is admitted", async function _DuplicateCallId()
	{
		const f = await _ToolContinuationHarness(2);
		f.model.request.mockResolvedValueOnce({ kind: ConversationModelResponseKinds.Tool, call: f.calls[0] }).mockResolvedValueOnce({ kind: ConversationModelResponseKinds.Tool, call: f.calls[0] });
		expect(await f.authority.advance(f.step)).toMatchObject({ outcome: "model_pending", ordinal: 2 });
		expect(f.model.request).toHaveBeenCalledTimes(2);
		expect(f.toolFlags.executions).toBe(1);
		expect((await f.store.load(f.step))?.protocol.steps).toHaveLength(2);
	});

	it("cannot issue another key when exact credential reuse fails", async function _ExpiredKey()
	{
		const f = await _ToolContinuationHarness();
		f.credentials.reuseExact.mockRejectedValueOnce(new Error("original key expired"));
		expect(await f.authority.advance(f.step)).toMatchObject({ outcome: "model_pending" });
		expect(f.model.request).toHaveBeenCalledOnce();
		expect(f.credentials.issueOnce).toHaveBeenCalledOnce();
		expect(await f.restart().advance(f.step)).toMatchObject({ outcome: "model_pending" });
		expect(f.credentials.reuseExact).toHaveBeenCalledOnce();
	});

	it("feeds two ordered assistant/tool exchanges into one final request", async function _TwoToolCycles()
	{
		const f = await _ToolContinuationHarness(2);
		expect(await f.authority.advance(f.step)).toEqual({ outcome: "completed" });
		expect(f.model.request).toHaveBeenCalledTimes(3);
		const requests = f.model.request.mock.calls.map(call => call[0]);
		expect(requests.map(request => request.history.length)).toEqual([0, 1, 2]);
		expect(requests[2].history.map((exchange: { readonly call: { readonly id: string } }) => exchange.call.id)).toEqual([f.calls[0].id, f.calls[1].id]);
		expect(requests[2].history.map((exchange: { readonly resultContent: string }) => exchange.resultContent)).toEqual([expect.stringContaining("private-result-1"), expect.stringContaining("private-result-2")]);
		expect(new Set(f.model.request.mock.calls.map(call => call[0].key))).toHaveLength(1);
		expect(f.credentials.issueOnce).toHaveBeenCalledOnce();
		expect(f.credentials.reuseExact).toHaveBeenCalledTimes(2);
		const turn = (await f.store.load(f.step))!;
		expect(turn.protocol.accounting).toMatchObject({ reservedModelCalls: 3, reservedToolInvocations: 2, toolResultCyclesFed: 2 });
		expect(turn.protocol.output).not.toBeNull();
		expect(f.rows.size).toBe(4);
	});

	it("keeps a sparse completion-token budget viable across a tool cycle", async function _SparseTokens()
	{
		const f = await _ToolContinuationHarness(1, 3);
		expect(await f.authority.advance(f.step)).toEqual({ outcome: "completed" });
		expect(f.model.request).toHaveBeenCalledTimes(2);
		expect(f.model.request.mock.calls.map(call => call[0].maxCompletionTokens)).toEqual([1, 2]);
		expect((await f.store.load(f.step))?.protocol.accounting.reservedCompletionTokens).toBe(3);
	});

	it.each([2, 3])("restarts from ResultReady ordinal %s without paying or executing prior tools again", async function _ResultReadyRestart(failedOrdinal)
	{
		const f = await _ToolContinuationHarness(2);
		let lost = false;
		f.history.beforeAppend = async function _LoseNextReservation(command)
		{
			if (!lost && (command.events[0].data["reservation"] as { ordinal?: number } | undefined)?.ordinal === failedOrdinal)
			{
				lost = true;
				throw new Error("successor reservation response lost");
			}
		};
		expect(await f.authority.advance(f.step)).toEqual({ outcome: "retry" });
		expect((await f.store.load(f.step))?.protocol.state).toBe("result_ready");
		f.history.beforeAppend = async function _Before() {};
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "completed" });
		expect(f.model.request).toHaveBeenCalledTimes(3);
		expect(f.toolFlags.executions).toBe(2);
		expect(f.credentials.issueOnce).toHaveBeenCalledOnce();
		expect(f.credentials.reuseExact).toHaveBeenCalledTimes(2);
	});
});
