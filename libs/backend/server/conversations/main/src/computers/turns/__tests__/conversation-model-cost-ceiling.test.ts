import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationComputerTurnProtocolStates } from "../conversation-computer-turn-protocol.types";
import { _ToolContinuationHarness } from "./conversation-tool-continuation.fixture";

/** Restores the clock after each cost and restart case. */
afterEach(function _Restore() { vi.restoreAllMocks(); });

/** Runs two tools under separately supplied revision and server cost ceilings. */
async function _CostHarness(maxCostUsdMicros: number | null, maximumBudgetUsd: number)
{
	return _ToolContinuationHarness(2, 600, function _CostLimits(candidate)
	{
		Object.assign(candidate, {
			maximumBudgetUsd,
			compiledInput: { ...candidate.compiledInput, budget: { ...candidate.compiledInput.budget, maxCostUsdMicros } },
		});
	});
}

/** Stops after a saved result but before the second model reservation can commit. */
async function _PauseAfterFirstResult(f: Awaited<ReturnType<typeof _CostHarness>>)
{
	f.history.beforeAppend = async function _Interrupt(command)
	{
		if ((command.events[0].data["reservation"] as { ordinal?: number } | undefined)?.ordinal === 2)
			throw new Error("process stopped before continuation reservation");
	};
	expect(await f.authority.advance(f.step)).toEqual({ outcome: "retry" });
	const saved = (await f.store.load(f.step))!;
	expect(saved.protocol.state).toBe(ConversationComputerTurnProtocolStates.ResultReady);
	expect(f.credentials.issueOnce).toHaveBeenCalledOnce();
	expect(f.credentials.reuseExact).not.toHaveBeenCalled();
	expect(f.model.request).toHaveBeenCalledOnce();
	f.history.beforeAppend = async function _Resume() {};
	return saved;
}

describe("conversation attempt cost ceiling", function _CostCeiling()
{
	it.each([
		{ maxCostUsdMicros: null, maximumBudgetUsd: 0.05, expectedUsd: 0.05 },
		{ maxCostUsdMicros: 25_000, maximumBudgetUsd: 0.05, expectedUsd: 0.025 },
		{ maxCostUsdMicros: 75_000, maximumBudgetUsd: 0.05, expectedUsd: 0.05 },
	])("keeps revision $maxCostUsdMicros and server $maximumBudgetUsd within one $expectedUsd key", async function _IntersectCeilings(test)
	{
		const f = await _CostHarness(test.maxCostUsdMicros, test.maximumBudgetUsd);
		expect(await f.authority.advance(f.step)).toEqual({ outcome: "completed" });
		const issued = f.credentials.issueOnce.mock.calls[0]![0];
		const saved = (await f.store.load(f.step))!;
		expect(saved.compile.runId).not.toBe(f.step);
		expect(issued).toMatchObject({ maxBudgetUsd: test.expectedUsd, bootstrapId: f.step, runId: saved.compile.runId, attempt: saved.compile.attempt, modelAlias: f.candidate.modelAlias });
		expect(f.credentials.issueOnce).toHaveBeenCalledOnce();
		expect(f.credentials.reuseExact).toHaveBeenCalledTimes(2);
		for (const [reused] of f.credentials.reuseExact.mock.calls)
			expect(reused).toMatchObject(issued);
		expect(f.model.request).toHaveBeenCalledTimes(3);
		expect(f.toolFlags.executions).toBe(2);
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "completed" });
		expect(f.credentials.issueOnce).toHaveBeenCalledOnce();
		expect(f.credentials.reuseExact).toHaveBeenCalledTimes(2);
	});

	it("retains the frozen server ceiling after restart even if newly compiled configuration is larger", async function _FrozenServerCeiling()
	{
		const f = await _CostHarness(null, 0.05);
		const saved = await _PauseAfterFirstResult(f);
		Object.assign(f.candidate, { maximumBudgetUsd: 10 });
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "completed" });
		const completed = (await f.store.load(f.step))!;
		expect(completed.maximumBudgetUsd).toBe(saved.maximumBudgetUsd);
		expect(completed.budget).toEqual(saved.budget);
		expect(f.credentials.issueOnce).toHaveBeenCalledOnce();
		expect(f.credentials.reuseExact).toHaveBeenCalledTimes(2);
		for (const [reused] of f.credentials.reuseExact.mock.calls)
			expect(reused).toMatchObject(f.credentials.issueOnce.mock.calls[0]![0]);
		expect(f.model.request).toHaveBeenCalledTimes(3);
	});

	it("refuses a changed revision cost ceiling before another reservation or key reuse", async function _RevisionCostDrift()
	{
		const f = await _CostHarness(25_000, 0.05);
		const saved = await _PauseAfterFirstResult(f);
		Object.assign(f.candidate, { compiledInput: { ...f.candidate.compiledInput, budget: { ...f.candidate.compiledInput.budget, maxCostUsdMicros: 50_000 } } });
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "retry" });
		expect(await f.store.load(f.step)).toEqual(saved);
		expect(f.credentials.issueOnce).toHaveBeenCalledOnce();
		expect(f.credentials.reuseExact).not.toHaveBeenCalled();
		expect(f.model.request).toHaveBeenCalledOnce();
		expect(f.toolFlags.executions).toBe(1);
		expect(f.outputPayloads.store).not.toHaveBeenCalled();
	});
});
