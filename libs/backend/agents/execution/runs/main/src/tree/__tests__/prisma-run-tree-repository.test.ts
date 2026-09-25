import { AgentRunTreeClosureReason, type AgentRunTreeAccount, type AgentRunTreeReservation, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { RunBudgetPolicy } from "@opencrane/contracts";

import { PrismaRunTreeRepository } from "../prisma-run-tree-repository";
import { RunTreeClosureReasons, type RunTreeChildCommand, type RunTreeResources } from "../run-tree.types";

/** Fixed database time keeps repository mapping separate from SQL deadline enforcement. */
const _NOW = new Date("2030-01-01T00:00:00.000Z");
/** Complete immutable budget supplied by the run snapshot reader. */
const _BUDGET: RunBudgetPolicy = { maxModelTurns: 100, maxCompletionTokens: 100_000, maxToolInvocations: 50, maxLoopIterations: 50, maxCostUsdMicros: 1_000_000, wallClockDeadlineEpochMs: _NOW.getTime() + 60_000 };
/** Trusted root initialization command; no browser or model grants are implied. */
const _ROOT = { siloId: "silo-tree", runId: "root", admissionKey: "root-admission", effectiveCostCapMicros: 800_000n };
/** Small transferable portion used in child and local reservation examples. */
const _PORTION: RunTreeResources = { modelCalls: 2, completionTokens: 200, toolInvocations: 1, loopIterations: 1, costMicros: 10_000n };

/**
 * Supplies typed ORM-shaped ports to the actual repository. These tests check request mapping,
 * replay and ordering; PostgreSQL suites separately prove triggers, debits and concurrent commits.
 */
function _fixture(budget: RunBudgetPolicy = _BUDGET)
{
	const accounts = new Map<string, AgentRunTreeAccount>();
	const reservations = new Map<string, AgentRunTreeReservation>();
	const order: string[] = [];
	const accountFind = vi.fn(async function _Find(args: { where: { runId: string; run: { siloId: string } } })
	{
		return args.where.run.siloId === _ROOT.siloId ? accounts.get(args.where.runId) ?? null : null;
	});
	const accountCreate = vi.fn(async function _Create(args: { data: Prisma.AgentRunTreeAccountUncheckedCreateInput })
	{
		const row = { ...args.data, revision: 0, closedAt: null, closureSourceRunId: null, closureReason: null } as AgentRunTreeAccount;
		accounts.set(row.runId, row);
		return row;
	});
	const accountUpdate = vi.fn(async function _Lock(args: { where: { runId: string } })
	{
		order.push("root-lock");
		const account = accounts.get(args.where.runId)!;
		account.revision += 1;
		return account;
	});
	const accountUpdateMany = vi.fn(async function _Close(args: { where: { runId: string }; data: Partial<AgentRunTreeAccount> })
	{
		order.push("closure");
		const account = accounts.get(args.where.runId)!;
		Object.assign(account, args.data);
		return { count: 1 };
	});
	const reservationFind = vi.fn(async function _Find(args: { where: { runId_idempotencyKey: { runId: string; idempotencyKey: string } } })
	{
		const key = args.where.runId_idempotencyKey;
		return reservations.get(`${key.runId}/${key.idempotencyKey}`) ?? null;
	});
	const reservationCreate = vi.fn(async function _Create(args: { data: Prisma.AgentRunTreeReservationUncheckedCreateInput })
	{
		const row = { ...args.data, createdAt: _NOW } as AgentRunTreeReservation;
		reservations.set(`${row.runId}/${row.idempotencyKey}`, row);
		return row;
	});
	const runFind = vi.fn().mockResolvedValue({ id: "admitted-run", attempt: 1, inputSnapshotDigest: "saved-digest" });
	const snapshotFind = vi.fn().mockResolvedValue({ budgetPolicy: budget });
	const clock = vi.fn(async function _Clock()
	{
		order.push("clock");
		return { now: _NOW };
	});
	const transaction = { agentRun: { findFirst: runFind }, runInputSnapshot: { findUnique: snapshotFind }, agentRunTreeAccount: { findFirst: accountFind, create: accountCreate, update: accountUpdate, updateMany: accountUpdateMany }, agentRunTreeReservation: { findUnique: reservationFind, create: reservationCreate }, agentRunAuthorityClock: { findUniqueOrThrow: clock } } as unknown as Prisma.TransactionClient;
	return { repository: new PrismaRunTreeRepository(transaction), transaction, accounts, reservations, order, accountCreate, accountUpdate, accountUpdateMany, reservationCreate, runFind, snapshotFind };
}

/** Selects a child portion without accepting root lineage from the caller. */
function _child(runId = "child", parentRunId = "root"): RunTreeChildCommand
{
	return { siloId: _ROOT.siloId, runId, parentRunId, admissionKey: `${runId}-admission`, deadlineAt: new Date(_BUDGET.wallClockDeadlineEpochMs), resources: _PORTION };
}

describe("PrismaRunTreeRepository", function _Suite()
{
	it("derives root counters and deadline from the saved snapshot", async function _RootSnapshot()
	{
		const fixture = _fixture();
		const account = await fixture.repository.initializeRoot(_ROOT);
		expect(account).toMatchObject({ rootRunId: "root", parentRunId: null, allocatedModelCalls: 100, availableModelCalls: 100, allocatedCompletionTokens: 100_000, allocatedToolInvocations: 50, allocatedLoopIterations: 50, allocatedCostMicros: 800_000n, deadlineAt: new Date(_BUDGET.wallClockDeadlineEpochMs) });
		expect(fixture.snapshotFind).toHaveBeenCalledWith({ where: { runId_attempt_digest: { runId: "root", attempt: 1, digest: "saved-digest" } }, select: { budgetPolicy: true } });
	});

	it("uses a lower revision cost cap and retains a finite server cap for a null revision", async function _CostIntersection()
	{
		const lower = _fixture({ ..._BUDGET, maxCostUsdMicros: 50_000 });
		expect((await lower.repository.initializeRoot(_ROOT)).allocatedCostMicros).toBe(50_000n);
		const noRevisionCap = _fixture({ ..._BUDGET, maxCostUsdMicros: null });
		expect((await noRevisionCap.repository.initializeRoot(_ROOT)).allocatedCostMicros).toBe(800_000n);
	});

	it("recovers the same root after object replacement without granting another allowance", async function _RootReplay()
	{
		const fixture = _fixture();
		const first = await fixture.repository.initializeRoot(_ROOT);
		const recovered = new PrismaRunTreeRepository(fixture.transaction);
		expect(await recovered.initializeRoot(_ROOT)).toEqual(first);
		expect(fixture.accountCreate).toHaveBeenCalledTimes(1);
		await expect(recovered.initializeRoot({ ..._ROOT, effectiveCostCapMicros: 900_000n })).rejects.toThrow("replay changed");
		expect(fixture.accounts.get("root")?.allocatedCostMicros).toBe(800_000n);
	});

	it("refuses a missing run, snapshot or malformed budget without creating an account", async function _MissingAuthority()
	{
		const fixture = _fixture();
		fixture.runFind.mockResolvedValueOnce(null);
		await expect(fixture.repository.initializeRoot(_ROOT)).rejects.toThrow("admitted run");
		fixture.snapshotFind.mockResolvedValueOnce(null);
		await expect(fixture.repository.initializeRoot(_ROOT)).rejects.toThrow("frozen run budget");
		fixture.snapshotFind.mockResolvedValueOnce({ budgetPolicy: {} });
		await expect(fixture.repository.initializeRoot(_ROOT)).rejects.toThrow();
		expect(fixture.accountCreate).not.toHaveBeenCalled();
	});

	it("derives nested lineage from the parent and returns exact child replays", async function _ChildLineage()
	{
		const fixture = _fixture();
		await fixture.repository.initializeRoot(_ROOT);
		const child = await fixture.repository.allocateChild(_child());
		const grandchild = await fixture.repository.allocateChild(_child("grandchild", "child"));
		expect(child).toMatchObject({ parentRunId: "root", rootRunId: "root", allocatedCostMicros: _PORTION.costMicros });
		expect(grandchild).toMatchObject({ parentRunId: "child", rootRunId: "root" });
		expect(await fixture.repository.allocateChild(_child())).toEqual(child);
		expect(fixture.accountCreate).toHaveBeenCalledTimes(3);
		await expect(fixture.repository.allocateChild({ ..._child(), resources: { ..._PORTION, costMicros: 20_000n } })).rejects.toThrow("replay changed");
	});

	it("does not expose an account or allocate a child through a foreign silo", async function _SiloIsolation()
	{
		const fixture = _fixture();
		await fixture.repository.initializeRoot(_ROOT);
		expect(await fixture.repository.read("foreign", "root")).toBeNull();
		await expect(fixture.repository.allocateChild({ ..._child(), siloId: "foreign" })).rejects.toThrow("admitted parent and child");
		expect(fixture.accountCreate).toHaveBeenCalledTimes(1);
	});

	it("keeps the same local reservation across restart and rejects changed amounts or identifiers", async function _ReservationReplay()
	{
		const fixture = _fixture();
		await fixture.repository.initializeRoot(_ROOT);
		const command = { siloId: _ROOT.siloId, runId: "root", reservationId: "reserve-1", idempotencyKey: "model-1", resources: _PORTION };
		const receipt = await fixture.repository.reserve(command);
		const recovered = new PrismaRunTreeRepository(fixture.transaction);
		expect(await recovered.reserve(command)).toEqual(receipt);
		await expect(recovered.reserve({ ...command, reservationId: "replacement" })).rejects.toThrow("replay changed");
		await expect(recovered.reserve({ ...command, resources: { ..._PORTION, costMicros: 11_000n } })).rejects.toThrow("replay changed");
		expect(fixture.reservationCreate).toHaveBeenCalledTimes(1);
	});

	it("recovers existing reservation evidence after closure without issuing new work", async function _ClosedReceipt()
	{
		const fixture = _fixture();
		await fixture.repository.initializeRoot(_ROOT);
		const command = { siloId: _ROOT.siloId, runId: "root", reservationId: "reserve-1", idempotencyKey: "model-1", resources: _PORTION };
		const receipt = await fixture.repository.reserve(command);
		await fixture.repository.close({ siloId: _ROOT.siloId, runId: "root", sourceRunId: "root", reason: RunTreeClosureReasons.AuthorizedStop });
		expect(await fixture.repository.reserve(command)).toEqual(receipt);
		expect(fixture.reservationCreate).toHaveBeenCalledTimes(1);
	});

	it("locks the root before closing a descendant and uses database time", async function _CloseOrdering()
	{
		const fixture = _fixture();
		await fixture.repository.initializeRoot(_ROOT);
		await fixture.repository.allocateChild(_child());
		const command = { siloId: _ROOT.siloId, runId: "child", sourceRunId: "root", reason: RunTreeClosureReasons.AuthorizedStop };
		const closed = await fixture.repository.close(command);
		expect(fixture.order).toEqual(["root-lock", "clock", "closure"]);
		expect(fixture.accountUpdate).toHaveBeenCalledWith({ where: { runId: "root" }, data: { revision: { increment: 1 } } });
		expect(closed).toMatchObject({ closedAt: _NOW, closureSourceRunId: "root", closureReason: RunTreeClosureReasons.AuthorizedStop });
		expect(fixture.accounts.get("root")?.closedAt).toBeNull();
		expect(await fixture.repository.close(command)).toEqual(closed);
		expect(fixture.accountUpdateMany).toHaveBeenCalledTimes(1);
		await expect(fixture.repository.close({ ...command, reason: RunTreeClosureReasons.TerminalRun })).rejects.toThrow("replay changed");
	});

	it("rechecks the saved closure winner after losing the conditional update", async function _ClosureWinner()
	{
		const fixture = _fixture();
		await fixture.repository.initializeRoot(_ROOT);
		fixture.accountUpdateMany.mockImplementationOnce(async function _OtherWinner()
		{
			Object.assign(fixture.accounts.get("root")!, { closedAt: _NOW, closureSourceRunId: "root", closureReason: AgentRunTreeClosureReason.TerminalRun });
			return { count: 0 };
		});
		await expect(fixture.repository.close({ siloId: _ROOT.siloId, runId: "root", sourceRunId: "root", reason: RunTreeClosureReasons.AuthorizedStop })).rejects.toThrow("replay changed");
	});

	it("propagates database failures without manufacturing a successful reservation", async function _DatabaseFailure()
	{
		const fixture = _fixture();
		await fixture.repository.initializeRoot(_ROOT);
		const failure = new Error("simulated database refusal");
		fixture.reservationCreate.mockRejectedValueOnce(failure);
		await expect(fixture.repository.reserve({ siloId: _ROOT.siloId, runId: "root", reservationId: "reserve-1", idempotencyKey: "model-1", resources: _PORTION })).rejects.toBe(failure);
		expect(fixture.reservations.size).toBe(0);
	});
});
