import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationModelResponseKinds, ConversationModelToolModes, ConversationToolProposalOutcomes } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { _ToolContinuationHarness } from "./conversation-tool-continuation.fixture";
import { ConversationComputerToolResultOutcomes } from "../conversation-computer-continuation.types";

afterEach(() => { vi.restoreAllMocks(); });

/** Pause at an actual durable boundary while another server handler reaches the same state. */
function _Barrier()
{
	let release!: () => void;
	const promise = new Promise<void>(resolve => { release = resolve; });
	return { promise, release };
}

describe("one governed tool and its model continuation", function _Continuation()
{
	it("keeps original input and exact tool-call pairing, spends one shared allowance and posts one final answer", async function _Answer()
	{
		const f = await _ToolContinuationHarness();
		expect(await f.authority.advance(f.step)).toEqual({ outcome: "completed" });
		expect(f.model.request).toHaveBeenCalledTimes(2);
		const [first, second] = f.model.request.mock.calls.map(call => call[0]);
		expect(first).toMatchObject({ tools: ConversationModelToolModes.Select, maxCompletionTokens: 50, continuation: null });
		expect(second).toMatchObject({ tools: ConversationModelToolModes.None, maxCompletionTokens: 50, continuation: { call: f.call } });
		expect(second.continuation.resultContent).toContain("private-result");
		expect(second.compiledInput).toEqual(first.compiledInput);
		expect(second.key).toBe(first.key);
		expect(f.credentials.issueOnce).toHaveBeenCalledOnce();
		expect(f.credentials.reuseExact).toHaveBeenCalledOnce();
		expect(f.toolFlags).toMatchObject({ executions: 1, acknowledgements: 1, consumed: true });
		const turn = (await f.store.load(f.step))!;
		expect(turn.toolSelection).not.toBeNull();
		expect(turn.continuationReservation?.ordinal).toBe(2);
		expect(turn.continuationReservation?.invocationFence).not.toBe(turn.modelReservation?.invocationFence);
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
		expect((await f.store.load(f.step))?.toolSelection).toBeNull();
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

	it("pauses an approval proposal, admits exactly once after the owner decision, and replays safely", async function _ApprovalReplay()
	{
		const f = await _ToolContinuationHarness();
		Object.assign(f.candidate.compiledInput.tools[0], { requiresApproval: true });
		let decision: "awaiting" | "ready" = "awaiting";
		f.proposals.admit.mockImplementation(async function _Admit(turn)
		{
			if (decision === "ready")
				f.toolFlags.executions++;
			return { proposalId: turn.toolSelection!.proposalId, outcome: ConversationToolProposalOutcomes.Existing };
		});
		f.results.read.mockImplementation(async function _Read(turn)
		{
			if (decision === "awaiting")
				return { outcome: ConversationComputerToolResultOutcomes.Pending, waitFor: "approval", waitUntilEpochMs: Date.now() + 60_000 } as const;
			const payload = { toolInvocationId: turn.toolSelection!.proposalId, outcome: "succeeded" as const, result: { record: "private-result" } };
			return { outcome: ConversationComputerToolResultOutcomes.Available, payload, payloadDigest: ___DigestCanonicalJson(payload), notAfterEpochMs: Date.now() + 60_000 } as const;
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
		f.proposals.admit.mockResolvedValue({ proposalId: f.call.id, outcome: ConversationToolProposalOutcomes.Existing });
		f.results.read.mockImplementation(async function _Read()
		{
			return denied ? { outcome: ConversationComputerToolResultOutcomes.Unavailable } as const : { outcome: ConversationComputerToolResultOutcomes.Pending, waitFor: "approval" } as const;
		});
		expect(await f.authority.advance(f.step)).toMatchObject({ outcome: "tool_pending", waitFor: "approval" });
		denied = true;
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "authority_ended" });
		expect(f.toolFlags.executions).toBe(0);
	});

	it("recovers exact continuation custody after its response is lost before reservation", async function _ContinuationCustody()
	{
		const f = await _ToolContinuationHarness();
		const store = f.custody.storeContinuation.bind(f.custody);
		vi.spyOn(f.custody, "storeContinuation").mockImplementationOnce(async function _LostReply(turn, continuation)
		{
			await store(turn, continuation);
			throw new Error("continuation custody response lost");
		});
		expect(await f.authority.advance(f.step)).toEqual({ outcome: "retry" });
		expect((await f.store.load(f.step))?.continuationReservation).toBeNull();
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
		expect((await f.store.load(f.step))?.continuationReservation).not.toBeNull();
		now += 30_000;
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "response_unavailable" });
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
		expect(await f.authority.advance(f.step)).toMatchObject({ outcome: "model_pending" });
		expect((await f.store.load(f.step))?.outputReceipt === null).toBe(!accepted);
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
		expect((await f.store.load(f.step))?.outputReceipt).toBeNull();
		expect(f.history.streams.get(f.stream)).toHaveLength(2);
	});

	it("refuses a second tool declaration and never admits a second execution", async function _NoSecondTool()
	{
		const f = await _ToolContinuationHarness();
		f.model.request.mockResolvedValue({ kind: ConversationModelResponseKinds.Tool, call: f.call });
		expect(await f.authority.advance(f.step)).toMatchObject({ outcome: "model_pending" });
		expect(f.toolFlags.executions).toBe(1);
		expect(f.model.request).toHaveBeenCalledTimes(2);
		expect((await f.store.load(f.step))?.outputReceipt).toBeNull();
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
});
