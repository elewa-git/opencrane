import { AgentRoutineFiringTrigger, AgentRunState, AgentRunTerminalReason as PrismaTerminalReason, AgentRunTrigger, type Prisma } from "@prisma/client";

import { AgentRunTerminalReasons, RoutineFiringTrigger, type AgentRunTerminalReason } from "@opencrane/models/agents";

import type { RoutineRunHistoryFact, RoutineRunHistoryRepository, RoutineRunHistoryRequest } from "./routine-run-history.types";

/** Maps every persisted terminal reason to the dependency-neutral model value. */
const _TERMINAL_REASON = new Map<PrismaTerminalReason, AgentRunTerminalReason>([
	[PrismaTerminalReason.Success, AgentRunTerminalReasons.Success],
	[PrismaTerminalReason.PolicyDenied, AgentRunTerminalReasons.PolicyDenied],
	[PrismaTerminalReason.BudgetExhausted, AgentRunTerminalReasons.BudgetExhausted],
	[PrismaTerminalReason.RuntimeFailure, AgentRunTerminalReasons.RuntimeFailure],
	[PrismaTerminalReason.InvalidInput, AgentRunTerminalReasons.InvalidInput],
	[PrismaTerminalReason.UserCancelled, AgentRunTerminalReasons.UserCancelled],
]);

/** Reads terminal and settled-cost facts without letting scheduling reinterpret raw AgentRun rows. */
export class PrismaRoutineRunHistoryRepository implements RoutineRunHistoryRepository
{
	/** Shares the routine read transaction so firing and run coordinates cannot cross snapshots. */
	public constructor(private readonly transaction: Prisma.TransactionClient) {}

	/** @inheritdoc */
	public async read(requests: readonly RoutineRunHistoryRequest[]): Promise<readonly RoutineRunHistoryFact[]>
	{
		if (requests.length === 0)
			return [];
		if (requests.length > 25 || new Set(requests.map(request => request.runId)).size !== requests.length)
			throw new Error("routine history requires a bounded set of distinct runs");
		const runs = await this.transaction.agentRun.findMany({ where: { id: { in: requests.map(request => request.runId) } }, select: { id: true, siloId: true, routineId: true, routineRevision: true, routineFiringId: true, conversationId: true, trigger: true, routineScheduledSlot: true, state: true, finishedAt: true, terminalReason: true, costAmount: true, costCurrency: true, scheduledFiring: { select: { id: true, siloId: true, routineId: true, routineRevision: true, conversationId: true, runId: true, trigger: true, scheduledSlot: true } } } });
		const runById = new Map(runs.map(run => [run.id, run]));
		return requests.map(function _Fact(request): RoutineRunHistoryFact
		{
			const run = runById.get(request.runId);
			if (run === undefined || !_Matches(request, run))
				throw new Error("routine history requires the reciprocal saved run and firing");
			_ValidateLifecycle(run.state, run.finishedAt, run.terminalReason);
			if ((run.costAmount === null) !== (run.costCurrency === null))
				throw new Error("routine history found incomplete settled cost");
			const actualCost = _Cost(run.costAmount, run.costCurrency);
			const terminalReason = run.terminalReason === null ? null : _TERMINAL_REASON.get(run.terminalReason);
			if (terminalReason === undefined)
				throw new Error("routine history found an unknown run terminal reason");
			return { runId: run.id, terminalReason, actualCost };
		});
	}
}

/** Verifies the reciprocal routine, firing, trigger, slot, and conversation coordinates. */
function _Matches(request: RoutineRunHistoryRequest, run: { readonly siloId: string; readonly routineId: string | null; readonly routineRevision: number | null; readonly routineFiringId: string | null; readonly conversationId: string | null; readonly trigger: AgentRunTrigger; readonly routineScheduledSlot: Date | null; readonly scheduledFiring: { readonly id: string; readonly siloId: string; readonly routineId: string; readonly routineRevision: number; readonly conversationId: string; readonly runId: string | null; readonly trigger: AgentRoutineFiringTrigger; readonly scheduledSlot: Date | null } | null }): boolean
{
	const runTrigger = request.trigger === RoutineFiringTrigger.Automatic ? AgentRunTrigger.Scheduled : AgentRunTrigger.Manual;
	const firingTrigger = request.trigger === RoutineFiringTrigger.Automatic ? AgentRoutineFiringTrigger.Automatic : AgentRoutineFiringTrigger.Manual;
	const firing = run.scheduledFiring;
	if (firing === null)
		return false;
	return run.siloId === request.siloId && run.routineId === request.routineId && run.routineRevision === request.routineRevision && run.routineFiringId === request.firingId && run.conversationId === request.conversationId && run.trigger === runTrigger && _SameInstant(run.routineScheduledSlot, request.scheduledSlot) && firing.id === request.firingId && firing.siloId === request.siloId && firing.routineId === request.routineId && firing.routineRevision === request.routineRevision && firing.conversationId === request.conversationId && firing.runId === request.runId && firing.trigger === firingTrigger && _SameInstant(firing.scheduledSlot, request.scheduledSlot);
}

/** Requires terminal fields exactly on terminal run states. */
function _ValidateLifecycle(state: AgentRunState, finishedAt: Date | null, terminalReason: PrismaTerminalReason | null): void
{
	const terminal = state === AgentRunState.Completed || state === AgentRunState.Cancelled || state === AgentRunState.Failed;
	if (terminal !== (finishedAt !== null) || terminal !== (terminalReason !== null))
		throw new Error("routine history found inconsistent run terminal evidence");
}

/** Projects a complete nonnegative settled-cost pair. */
function _Cost(amount: Prisma.Decimal | null, currency: string | null): { readonly amount: string; readonly currency: string } | null
{
	if (amount === null || currency === null)
		return null;
	const numeric = amount.toNumber();
	if (!Number.isFinite(numeric) || numeric < 0 || currency.length === 0 || currency.length > 16 || currency.trim() !== currency)
		throw new Error("routine history found invalid settled cost");
	return { amount: amount.toString(), currency };
}

/** Compares a stored UTC instant with its public ISO coordinate. */
function _SameInstant(value: Date | null, expected: string | null): boolean
{
	return value?.toISOString() === expected || value === null && expected === null;
}
