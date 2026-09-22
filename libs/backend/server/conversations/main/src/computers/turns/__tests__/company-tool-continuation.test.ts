import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationModelResponseKinds, ConversationModelToolModes } from "@opencrane/contracts";

import { ConversationComputerToolResultOutcomes } from "../conversation-computer-continuation.types";
import { ConversationComputerTurnProtocolStates } from "../conversation-computer-turn-protocol.types";
import { _ToolContinuationHarness } from "./conversation-tool-continuation.fixture";

/** Keeps time and injected restart failures isolated between cases. */
afterEach(function _Restore() { vi.restoreAllMocks(); });

/** Runs the real turn and encrypted-custody owners with the limits published for new company assistants. */
async function _CompanyHarness()
{
	const f = await _ToolContinuationHarness(8, 32_000, function _CompanyLimits(candidate)
	{
		Object.assign(candidate, { compiledInput: {
			...candidate.compiledInput,
			model: { ...candidate.compiledInput.model, maxOutputTokens: 4_096 },
			budget: { maxCompletionTokens: 32_000, maxModelTurns: 9, maxToolInvocations: 8, maxCostUsdMicros: null, maxLoopIterations: 8, wallClockDeadlineEpochMs: Date.now() + 120_000 },
		} });
	});
	const readResult = f.results.read.getMockImplementation()!;
	f.results.read.mockImplementation(async function _ResultWithLongerAuthority(turn)
	{
		const result = await readResult(turn);
		if (result.outcome === ConversationComputerToolResultOutcomes.Available)
			return { ...result, notAfterEpochMs: f.candidate.compiledInput.budget.wallClockDeadlineEpochMs + 60_000 };
		return result;
	});
	f.model.request.mockImplementation(async function _ReadSavedResult(input)
	{
		const previous = input.history.at(-1);
		const query = previous === undefined ? "discover-records" : JSON.parse(previous.resultContent).result.record;
		if (input.tools === ConversationModelToolModes.None)
			return { kind: ConversationModelResponseKinds.Text, text: `Reconciled through ${query}` };
		const call = f.calls[input.history.length]!;
		return { kind: ConversationModelResponseKinds.Tool, call: { ...call, arguments: JSON.stringify({ query }) } };
	});
	return f;
}

/** Proves allowance consumption and content-dependent arguments, not just a model-call count. */
async function _AssertCompleted(f: Awaited<ReturnType<typeof _CompanyHarness>>)
{
	const requests = f.model.request.mock.calls.map(call => call[0]);
	expect(requests.map(request => request.history.length)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
	expect(requests.map(request => request.maxCompletionTokens)).toEqual([4_096, 4_096, 4_096, 4_096, 4_096, 4_096, 3_712, 1_856, 1_856]);
	expect(requests.map(request => request.tools)).toEqual([...Array(8).fill(ConversationModelToolModes.Select), ConversationModelToolModes.None]);
	for (const request of requests)
		expect(request.compiledInput).toEqual(f.candidate.compiledInput);
	const turn = (await f.store.load(f.step))!;
	expect(turn.budget).toEqual(f.candidate.compiledInput.budget);
	expect(turn.protocol.steps.map(step => step.reservation.authorityExpiresAtEpochMs)).toEqual(Array(9).fill(turn.budget.wallClockDeadlineEpochMs));
	expect(turn.protocol.accounting).toEqual({ reservedModelCalls: 9, reservedCompletionTokens: 32_000, reservedToolInvocations: 8, toolResultCyclesFed: 8 });
	expect(requests[8].history.map((exchange: { readonly call: { readonly arguments: string } }) => JSON.parse(exchange.call.arguments).query)).toEqual(["discover-records", ...Array.from({ length: 7 }, (_, index) => `private-result-${index + 1}`)]);
	expect(new Set(turn.protocol.steps.slice(0, 8).map(step => step.selection!.toolInvocationId)).size).toBe(8);
	expect(f.toolFlags).toMatchObject({ executions: 8, acknowledgements: 8 });
	expect(f.proposals.admit).toHaveBeenCalledTimes(8);
	expect(f.credentials.issueOnce).toHaveBeenCalledOnce();
	expect(f.credentials.reuseExact).toHaveBeenCalledTimes(8);
	expect(f.rows.size).toBe(16);
	expect(f.outputPayloads.store).toHaveBeenCalledOnce();
	expect([...f.payloads.values()].map(payload => payload.text)).toEqual(["Reconciled through private-result-8"]);
	expect(f.history.streams.get(f.stream)).toHaveLength(3);
	expect(await f.restart().advance(f.step)).toEqual({ outcome: "completed" });
	expect(f.model.request).toHaveBeenCalledTimes(9);
	expect(f.toolFlags.executions).toBe(8);
}

describe("company assistant multi-step limits", function _Suite()
{
	it("uses each saved result in the next tool arguments and reserves an answer within the original allowance", async function _DependentCalls()
	{
		const f = await _CompanyHarness();
		expect(await f.authority.advance(f.step)).toEqual({ outcome: "completed" });
		await _AssertCompleted(f);
	});

	it.each([5, 9])("resumes before model call %s without repeating saved calls or renewing the budget", async function _Restart(ordinal)
	{
		const f = await _CompanyHarness();
		let interrupted = false;
		f.history.beforeAppend = async function _InterruptReservation(command)
		{
			if (!interrupted && (command.events[0].data["reservation"] as { ordinal?: number } | undefined)?.ordinal === ordinal)
			{
				interrupted = true;
				throw new Error("server stopped before the next reservation");
			}
		};
		expect(await f.authority.advance(f.step)).toEqual({ outcome: "retry" });
		const saved = (await f.store.load(f.step))!;
		expect(saved.protocol.state).toBe(ConversationComputerTurnProtocolStates.ResultReady);
		expect(saved.protocol.accounting.reservedModelCalls).toBe(ordinal - 1);
		expect(saved.protocol.accounting.reservedToolInvocations).toBe(ordinal - 1);
		f.history.beforeAppend = async function _Resume() {};
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "completed" });
		await _AssertCompleted(f);
	});

	it("does not admit a ninth tool even if the final model response attempts one", async function _RefusesNinthTool()
	{
		const f = await _CompanyHarness();
		const model = f.model.request.getMockImplementation()!;
		f.model.request.mockImplementation(async function _ExtraTool(input)
		{
			if (input.tools === ConversationModelToolModes.None)
				return { kind: ConversationModelResponseKinds.Tool, call: { ...f.calls[0], id: "forbidden-ninth-call" } };
			return model(input);
		});
		expect(await f.authority.advance(f.step)).toMatchObject({ outcome: "model_pending", ordinal: 9 });
		expect(await f.restart().advance(f.step)).toMatchObject({ outcome: "model_pending", ordinal: 9 });
		expect(f.model.request).toHaveBeenCalledTimes(9);
		expect(f.toolFlags.executions).toBe(8);
		expect(f.proposals.admit).toHaveBeenCalledTimes(8);
		expect((await f.store.load(f.step))?.protocol.output).toBeNull();
		expect(f.outputPayloads.store).not.toHaveBeenCalled();
	});

	it("cannot extend the original two-minute deadline after an interior saved result", async function _ExpiredOriginalDeadline()
	{
		let now = Date.now();
		vi.spyOn(Date, "now").mockImplementation(function _Now() { return now; });
		const f = await _CompanyHarness();
		f.history.beforeAppend = async function _InterruptReservation(command)
		{
			if ((command.events[0].data["reservation"] as { ordinal?: number } | undefined)?.ordinal === 5)
				throw new Error("server stopped before the next reservation");
		};
		expect(await f.authority.advance(f.step)).toEqual({ outcome: "retry" });
		const saved = (await f.store.load(f.step))!;
		expect(saved.protocol.state).toBe(ConversationComputerTurnProtocolStates.ResultReady);
		now = saved.budget.wallClockDeadlineEpochMs + 1;
		f.history.beforeAppend = async function _Resume() {};
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "response_unavailable" });
		const expired = (await f.store.load(f.step))!;
		expect(expired.budget).toEqual(saved.budget);
		expect(expired.protocol.accounting).toEqual(saved.protocol.accounting);
		expect(f.model.request).toHaveBeenCalledTimes(4);
		expect(f.toolFlags.executions).toBe(4);
		expect(f.credentials.issueOnce).toHaveBeenCalledOnce();
		expect(f.outputPayloads.store).not.toHaveBeenCalled();
	});
});
