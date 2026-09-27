import { AgentRoutineFiringTrigger, AgentRunState, AgentRunTerminalReason, AgentRunTrigger, Prisma } from "@prisma/client";

import { RoutineFiringTrigger, AgentRunTerminalReasons } from "@opencrane/models/agents";
import { describe, expect, it, vi } from "vitest";

import { PrismaRoutineRunHistoryRepository } from "../prisma-routine-run-history-reader";
import type { RoutineRunHistoryRequest } from "../routine-run-history.types";

/** Stable automatic routine history request used by the repository fixture. */
const _REQUEST: RoutineRunHistoryRequest = { runId: "run-1", siloId: "silo-1", routineId: "routine-1", routineRevision: 3, firingId: "firing-1", conversationId: "conversation-1", trigger: RoutineFiringTrigger.Automatic, scheduledSlot: "2026-09-01T01:00:00.000Z" };
/** Persisted slot shared by the run and reciprocal firing. */
const _SLOT = new Date(_REQUEST.scheduledSlot!);

/** Builds a complete persisted run and reciprocal firing row. */
function _Row(patch: Record<string, unknown> = {}): Record<string, unknown>
{
	return {
		id: "run-1", siloId: "silo-1", routineId: "routine-1", routineRevision: 3, routineFiringId: "firing-1", conversationId: "conversation-1", trigger: AgentRunTrigger.Scheduled, routineScheduledSlot: _SLOT, state: AgentRunState.Completed, finishedAt: _SLOT, terminalReason: AgentRunTerminalReason.Success, costAmount: null, costCurrency: null,
		scheduledFiring: { id: "firing-1", siloId: "silo-1", routineId: "routine-1", routineRevision: 3, conversationId: "conversation-1", runId: "run-1", trigger: AgentRoutineFiringTrigger.Automatic, scheduledSlot: _SLOT },
		...patch,
	};
}

/** Creates the narrow read-only Prisma delegate used by each test. */
function _Fixture(rows: readonly Record<string, unknown>[] = [_Row()])
{
	const findMany = vi.fn(async function _FindMany() { return rows; });
	const transaction = { agentRun: { findMany } };
	return { reader: new PrismaRoutineRunHistoryRepository(transaction as unknown as Prisma.TransactionClient), findMany };
}

describe("PrismaRoutineRunHistoryRepository", function _Suite()
{
	it("reads one reciprocal terminal run and preserves a complete settled cost", async function _ReadsFact()
	{
		const fixture = _Fixture([_Row({ costAmount: new Prisma.Decimal("12.50"), costCurrency: "USD" })]);

		await expect(fixture.reader.read([_REQUEST])).resolves.toEqual([{ runId: "run-1", terminalReason: AgentRunTerminalReasons.Success, actualCost: { amount: "12.5", currency: "USD" } }]);
		expect(fixture.findMany).toHaveBeenCalledTimes(1);
	});

	it("returns null cost only for a null pair and never substitutes estimates", async function _AllowsNullCostPair()
	{
		const fixture = _Fixture([_Row()]);

		await expect(fixture.reader.read([_REQUEST])).resolves.toMatchObject([{ actualCost: null }]);
	});

	it.each([
		["missing run", []],
		["missing reciprocal firing", [_Row({ scheduledFiring: null })]],
		["wrong firing backlink", [_Row({ scheduledFiring: { ...(_Row().scheduledFiring as object), runId: "run-2" } })]],
		["wrong routine", [_Row({ routineId: "routine-2" })]],
		["wrong trigger", [_Row({ trigger: AgentRunTrigger.Manual })]],
		["wrong slot", [_Row({ routineScheduledSlot: new Date("2026-09-01T02:00:00.000Z") })]],
		["wrong firing trigger", [_Row({ scheduledFiring: { ...(_Row().scheduledFiring as object), trigger: AgentRoutineFiringTrigger.Manual } })]],
		["wrong firing slot", [_Row({ scheduledFiring: { ...(_Row().scheduledFiring as object), scheduledSlot: new Date("2026-09-01T02:00:00.000Z") } })]],
	])("rejects %s", async function _RejectsCoordinateMismatch(_label, rows)
	{
		const fixture = _Fixture(rows);

		await expect(fixture.reader.read([_REQUEST])).rejects.toThrow();
	});

	it.each([
		["running with terminal evidence", { state: AgentRunState.Running, finishedAt: _SLOT, terminalReason: AgentRunTerminalReason.Success }],
		["completed without terminal evidence", { state: AgentRunState.Completed, finishedAt: null, terminalReason: null }],
		["unknown terminal reason", { terminalReason: "unknown_reason" }],
		["inherited terminal reason", { terminalReason: "toString" }],
	])("rejects %s", async function _RejectsLifecycle(_label, patch)
	{
		const fixture = _Fixture([_Row(patch)]);

		await expect(fixture.reader.read([_REQUEST])).rejects.toThrow();
	});

	it.each([
		["amount without currency", { costAmount: new Prisma.Decimal("1"), costCurrency: null }],
		["currency without amount", { costAmount: null, costCurrency: "USD" }],
		["negative amount", { costAmount: new Prisma.Decimal("-1"), costCurrency: "USD" }],
		["nonfinite amount", { costAmount: new Prisma.Decimal("NaN"), costCurrency: "USD" }],
		["blank currency", { costAmount: new Prisma.Decimal("1"), costCurrency: " " }],
		["padded currency", { costAmount: new Prisma.Decimal("1"), costCurrency: " USD" }],
		["long currency", { costAmount: new Prisma.Decimal("1"), costCurrency: "X".repeat(17) }],
	])("rejects %s", async function _RejectsCost(_label, patch)
	{
		const fixture = _Fixture([_Row(patch)]);

		await expect(fixture.reader.read([_REQUEST])).rejects.toThrow();
	});

	it("rejects reciprocal mismatches in a batched request and does not use estimates", async function _BatchesAndRejects()
	{
		const fixture = _Fixture([_Row(), _Row({ id: "run-2", routineFiringId: "firing-2", scheduledFiring: { id: "firing-2", siloId: "silo-1", routineId: "routine-1", routineRevision: 3, conversationId: "conversation-1", runId: "run-2", trigger: AgentRoutineFiringTrigger.Automatic, scheduledSlot: _SLOT } })]);
		const second = { ..._REQUEST, runId: "run-2", firingId: "firing-2" };

		await expect(fixture.reader.read([_REQUEST, second])).resolves.toHaveLength(2);
		expect(fixture.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["run-1", "run-2"] } } }));
	});
});
