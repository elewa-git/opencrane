import { AgentRoutineFiringDisposition, AgentRunState, AgentRunTerminalReason, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { RoutineRunProgressObservation } from "@opencrane/backend/server/agents/scheduling/contract";
import { AgentRunStates, AgentRunTerminalReasons, RoutineFiringDisposition } from "@opencrane/models/agents";

import { PrismaRoutineRunProgressRepository } from "../prisma-routine-run-progress-repository";

const _NOW = new Date("2026-09-26T12:00:00.000Z");
const _A = { resultReference: "unavailable-1", resultDigest: `sha256:${"a".repeat(64)}` as const };
const _B = { resultReference: "answer-1", resultDigest: `sha256:${"b".repeat(64)}` as const };

/** Provides a complete observer record; each test changes only the source event it exercises. */
function _Observation(patch: Partial<RoutineRunProgressObservation> = {}): RoutineRunProgressObservation
{
	return { siloId: "silo-1", routineId: "routine-1", routineRevision: 2, firingId: "firing-1", runId: "run-1", attempt: 1, inputSnapshotDigest: `sha256:${"1".repeat(64)}`, sourceState: AgentRunStates.Running, sourceFinishedAt: null, sourceTerminalReason: null, sourceCancellationCommandId: null, sourceCancellationCommandDigest: null, disposition: RoutineFiringDisposition.Running, resultReference: null, resultDigest: null, ...patch };
}

/** Records projection writes while keeping a separate inspectable current-source read. */
function _Fixture(disposition: AgentRoutineFiringDisposition = AgentRoutineFiringDisposition.Running, evidence: { resultReference: string | null; resultDigest: string | null } = { resultReference: null, resultDigest: null })
{
	const saved = { disposition, ...evidence };
	const updateMany = vi.fn(async function _Update({ data }: { data: typeof saved }) { Object.assign(saved, data); return { count: 1 }; });
	const transaction = {
		agentRun: { findFirst: vi.fn().mockResolvedValue({ id: "run-1" }) },
		agentRoutineFiring: { findFirst: vi.fn(async function _Read() { return { ...saved }; }), updateMany },
		agentRunAuthorityClock: { findUnique: vi.fn().mockResolvedValue({ now: _NOW }) },
	};
	return { saved, transaction, repository: new PrismaRoutineRunProgressRepository(transaction as unknown as Prisma.TransactionClient) };
}

describe("PrismaRoutineRunProgressRepository", function _Suite()
{
	it("retains evidence A through resumed running and completed evidence B", async function _CompletedResolution()
	{
		const f = _Fixture(AgentRoutineFiringDisposition.Uncertain, _A);
		await f.repository.recordRunProgress(_Observation());
		await f.repository.recordRunProgress(_Observation({ sourceState: AgentRunStates.Completed, sourceFinishedAt: _NOW.toISOString(), sourceTerminalReason: AgentRunTerminalReasons.Success, disposition: RoutineFiringDisposition.Completed, ..._B }));
		expect(f.saved).toMatchObject({ disposition: AgentRoutineFiringDisposition.Completed, ..._A, finishedAt: _NOW });
		expect(f.transaction.agentRoutineFiring.updateMany).toHaveBeenCalledTimes(2);
	});

	it("retains evidence A when cancellation B resolves uncertainty", async function _CancelledResolution()
	{
		const f = _Fixture(AgentRoutineFiringDisposition.Uncertain, _A);
		await f.repository.recordRunProgress(_Observation({ sourceState: AgentRunStates.Cancelled, sourceFinishedAt: _NOW.toISOString(), sourceTerminalReason: AgentRunTerminalReasons.UserCancelled, sourceCancellationCommandId: "stop-1", sourceCancellationCommandDigest: _B.resultDigest, disposition: RoutineFiringDisposition.Cancelled, ..._B }));
		expect(f.saved).toMatchObject({ disposition: AgentRoutineFiringDisposition.Cancelled, ..._A });
		expect(f.transaction.agentRun.findFirst).toHaveBeenCalledWith({ where: { id: "run-1", siloId: "silo-1", attempt: 1, routineFiringId: "firing-1", routineId: "routine-1", routineRevision: 2, inputSnapshotDigest: `sha256:${"1".repeat(64)}`, state: AgentRunState.Cancelled, finishedAt: _NOW, terminalReason: AgentRunTerminalReason.UserCancelled, cancellationCommandId: "stop-1", cancellationCommandDigest: _B.resultDigest }, select: { id: true } });
	});

	it("saves the first unavailable evidence and makes same-target replay idempotent", async function _Replay()
	{
		const f = _Fixture();
		const observation = _Observation({ sourceState: AgentRunStates.RecoveryRequired, disposition: RoutineFiringDisposition.Uncertain, ..._A });
		await f.repository.recordRunProgress(observation);
		await f.repository.recordRunProgress({ ...observation, ..._B });
		expect(f.saved).toMatchObject({ disposition: AgentRoutineFiringDisposition.Uncertain, ..._A });
		expect(f.transaction.agentRoutineFiring.updateMany).toHaveBeenCalledOnce();
		expect(f.transaction.agentRun.findFirst).toHaveBeenCalledTimes(2);
	});

	it("rejects a stale source even for same-target replay", async function _StaleSource()
	{
		const f = _Fixture();
		f.transaction.agentRun.findFirst.mockResolvedValue(null);
		await expect(f.repository.recordRunProgress(_Observation())).rejects.toThrow("source changed");
		expect(f.transaction.agentRoutineFiring.findFirst).not.toHaveBeenCalled();
		expect(f.transaction.agentRoutineFiring.updateMany).not.toHaveBeenCalled();
	});

	it("does not acknowledge an evidence-bearing state that has no saved evidence", async function _MissingEvidence()
	{
		const f = _Fixture(AgentRoutineFiringDisposition.Uncertain);
		await expect(f.repository.recordRunProgress(_Observation({ sourceState: AgentRunStates.RecoveryRequired, disposition: RoutineFiringDisposition.Uncertain, ..._A }))).rejects.toThrow("missing saved result evidence");
		expect(f.transaction.agentRoutineFiring.updateMany).not.toHaveBeenCalled();
	});

	it("rejects a missing reciprocal firing", async function _WrongFiring()
	{
		const f = _Fixture();
		f.transaction.agentRoutineFiring.findFirst.mockResolvedValue(null!);
		await expect(f.repository.recordRunProgress(_Observation())).rejects.toThrow("linked firing");
		expect(f.transaction.agentRoutineFiring.updateMany).not.toHaveBeenCalled();
	});

	it("rejects corrupt saved evidence even on an unchanged disposition", async function _PartialEvidence()
	{
		const f = _Fixture(AgentRoutineFiringDisposition.Running, { resultReference: "orphan", resultDigest: null });
		await expect(f.repository.recordRunProgress(_Observation())).rejects.toThrow("incomplete saved result");
	});

	it("will not reopen a terminal firing from a nonterminal source", async function _TerminalFence()
	{
		const f = _Fixture(AgentRoutineFiringDisposition.Completed, _B);
		await expect(f.repository.recordRunProgress(_Observation())).rejects.toThrow("transition is not allowed");
		expect(f.transaction.agentRoutineFiring.updateMany).not.toHaveBeenCalled();
	});

	it("reports a lost compare-and-set instead of acknowledging progress", async function _CasConflict()
	{
		const f = _Fixture();
		f.transaction.agentRoutineFiring.updateMany.mockResolvedValue({ count: 0 });
		await expect(f.repository.recordRunProgress(_Observation({ disposition: RoutineFiringDisposition.Waiting }))).rejects.toThrow("compare-and-set conflict");
	});

	it("rejects a missing database clock before any write", async function _ClockUnavailable()
	{
		const f = _Fixture();
		f.transaction.agentRunAuthorityClock.findUnique.mockResolvedValue(null);
		await expect(f.repository.recordRunProgress(_Observation({ disposition: RoutineFiringDisposition.Waiting }))).rejects.toThrow("clock is unavailable");
		expect(f.transaction.agentRoutineFiring.updateMany).not.toHaveBeenCalled();
	});
});
