import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RunTreeClosureReasons, type RunTreeChildCommand, type RunTreeReservationCommand, type RunTreeResources, type RunTreeRootCommand } from "../run-tree.types";
import { _OverlapRunTreeSqlCommands, _RunTreeSqlCommand, _SaveRunTreeSqlLegacyMint, _SaveRunTreeSqlStop, _SeedRunTreeSqlFixture } from "./run-tree-sql-fixture";
import type { RunTreeSqlFixture } from "./run-tree-sql-fixture.types";

/** Independent connections make each race use distinct PostgreSQL transactions. */
const _FIRST = new PrismaClient();
/** A second client cannot share the first transaction's snapshot or held locks. */
const _SECOND = new PrismaClient();

/** Divides each original allowance into the same number of hundredths. */
function _resources(units: number): RunTreeResources
{
	return { modelCalls: units, completionTokens: units * 10, toolInvocations: units, loopIterations: units, costMicros: BigInt(units) * 10_000n };
}

/** Builds root accounting for the fixture's already admitted first run. */
function _root(fixture: RunTreeSqlFixture): RunTreeRootCommand
{
	return { siloId: fixture.siloId, runId: fixture.runIds[0], admissionKey: `${fixture.runIds[0]}-admission`, effectiveCostCapMicros: 1_000_000n };
}

/** Selects an existing fixture run and transfers a portion from its chosen parent. */
function _child(fixture: RunTreeSqlFixture, index: number, units: number, parentIndex = 0): RunTreeChildCommand
{
	return { siloId: fixture.siloId, parentRunId: fixture.runIds[parentIndex], runId: fixture.runIds[index], admissionKey: `${fixture.runIds[index]}-admission`, resources: _resources(units), deadlineAt: fixture.deadlineAt };
}

/** Gives each logical effect a stable saved reservation identifier and retry key. */
function _reservation(fixture: RunTreeSqlFixture, units: number, runIndex = 0): RunTreeReservationCommand
{
	const id = randomUUID();
	return { siloId: fixture.siloId, runId: fixture.runIds[runIndex], reservationId: id, idempotencyKey: `${id}-key`, resources: _resources(units) };
}

/** Creates accounting through the actual repository rather than inserting account rows directly. */
async function _openRoot(fixture: RunTreeSqlFixture): Promise<void>
{
	await _RunTreeSqlCommand(_FIRST, async function _Open(_, repository) { await repository.initializeRoot(_root(fixture)); });
}

/** Makes a failed SQL expectation show the actual PostgreSQL message, including unexpected deadlocks. */
function _failureMessage(result: PromiseSettledResult<unknown>): string
{
	expect(result.status).toBe("rejected");
	if (result.status !== "rejected")
		throw new Error("The losing command unexpectedly committed");
	return String(result.reason);
}

describe.skipIf(process.env.OPENCRANE_RUN_TREE_SQL_QUALIFICATION !== "1")("run-tree repository concurrency on fresh PostgreSQL", function _Suite()
{
	beforeAll(async function _Connect()
	{
		if (!process.env.DATABASE_URL)
			throw new Error("Run-tree SQL qualification requires DATABASE_URL for a fresh test baseline");
		await Promise.all([_FIRST.$connect(), _SECOND.$connect()]);
	});
	afterAll(async function _Disconnect() { await Promise.all([_FIRST.$disconnect(), _SECOND.$disconnect()]); });

	it("commits one of two overlapping child allocations without duplicating the root allowance", async function _CompetingChildren()
	{
		const fixture = await _SeedRunTreeSqlFixture(3);
		await _openRoot(fixture);
		const overlap = await _OverlapRunTreeSqlCommands(_FIRST, _SECOND, fixture.runIds[0], async function _FirstChild(_, repository) { return repository.allocateChild(_child(fixture, 1, 60)); }, async function _SecondChild(_, repository) { return repository.allocateChild(_child(fixture, 2, 60)); });
		expect(overlap.backendPids.length).toBeGreaterThanOrEqual(2);
		expect(overlap.secondAttempts).toBeGreaterThanOrEqual(2);
		expect(overlap.results[0].status).toBe("fulfilled");
		expect(_failureMessage(overlap.results[1])).toContain("insufficient unreserved allowance");
		expect(await _FIRST.agentRunTreeAccount.findUnique({ where: { runId: fixture.runIds[0] } })).toMatchObject({ availableModelCalls: 40, availableCompletionTokens: 400, availableToolInvocations: 40, availableLoopIterations: 40, availableCostMicros: 400_000n });
		expect(await _FIRST.agentRunTreeAccount.count({ where: { rootRunId: fixture.runIds[0] } })).toBe(2);
		expect(await _FIRST.agentRunTreeAccount.findUnique({ where: { runId: fixture.runIds[2] } })).toBeNull();
	}, 30_000);

	it("replays an overlapping identical reservation after full rollback and debits once", async function _ReservationReplay()
	{
		const fixture = await _SeedRunTreeSqlFixture(1);
		await _openRoot(fixture);
		const command = _reservation(fixture, 10);
		const overlap = await _OverlapRunTreeSqlCommands(_FIRST, _SECOND, command.runId, async function _FirstReserve(_, repository) { return repository.reserve(command); }, async function _Replay(_, repository) { return repository.reserve(command); });
		expect(overlap.backendPids.length).toBeGreaterThanOrEqual(2);
		expect(overlap.secondAttempts).toBeGreaterThanOrEqual(2);
		expect(overlap.results[0].status).toBe("fulfilled");
		expect(overlap.results[1]).toEqual(overlap.results[0]);
		expect(await _FIRST.agentRunTreeReservation.count({ where: { runId: command.runId } })).toBe(1);
		expect(await _FIRST.agentRunTreeAccount.findUnique({ where: { runId: command.runId } })).toMatchObject({ availableModelCalls: 90, availableCompletionTokens: 900, availableCostMicros: 900_000n });
	}, 30_000);

	it.each([false, true])("fences overlapping descendant work when root Stop wins; child allocation=%s", async function _StopWins(allocateChild)
	{
		const fixture = await _SeedRunTreeSqlFixture(3);
		await _openRoot(fixture);
		await _RunTreeSqlCommand(_FIRST, async function _ExistingChild(_, repository) { await repository.allocateChild(_child(fixture, 1, 40)); });
		const command = _reservation(fixture, 10, 1);
		const overlap = await _OverlapRunTreeSqlCommands(_FIRST, _SECOND, fixture.runIds[0], async function _Stop(transaction, repository)
		{
			await _SaveRunTreeSqlStop(transaction, fixture, fixture.runIds[0], fixture.runIds[0]);
			return repository.close({ siloId: fixture.siloId, runId: fixture.runIds[0], sourceRunId: fixture.runIds[0], reason: RunTreeClosureReasons.AuthorizedStop });
		}, async function _LateWork(_, repository)
		{
			if (allocateChild)
				return repository.allocateChild(_child(fixture, 2, 10, 1));
			return repository.reserve(command);
		});
		expect(overlap.backendPids.length).toBeGreaterThanOrEqual(2);
		expect(overlap.secondAttempts).toBeGreaterThanOrEqual(2);
		expect(overlap.results[0].status).toBe("fulfilled");
		expect(_failureMessage(overlap.results[1])).toContain("ancestor no longer accepts work");
		expect(await _FIRST.agentRunTreeReservation.count({ where: { runId: command.runId } })).toBe(0);
		expect(await _FIRST.agentRunTreeAccount.findUnique({ where: { runId: fixture.runIds[2] } })).toBeNull();
		expect(await _FIRST.agentRunTreeAccount.findUnique({ where: { runId: fixture.runIds[1] } })).toMatchObject({ availableModelCalls: 40, closedAt: null });
	}, 30_000);

	it("preserves a reservation that commits before Stop and refuses subsequent work", async function _ReservationWins()
	{
		const fixture = await _SeedRunTreeSqlFixture(1);
		await _openRoot(fixture);
		const command = _reservation(fixture, 10);
		const overlap = await _OverlapRunTreeSqlCommands(_FIRST, _SECOND, command.runId, async function _Reserve(_, repository) { return repository.reserve(command); }, async function _Stop(transaction, repository)
		{
			await _SaveRunTreeSqlStop(transaction, fixture, command.runId, command.runId);
			return repository.close({ siloId: fixture.siloId, runId: command.runId, sourceRunId: command.runId, reason: RunTreeClosureReasons.AuthorizedStop });
		});
		expect(overlap.backendPids.length).toBeGreaterThanOrEqual(2);
		expect(overlap.secondAttempts).toBeGreaterThanOrEqual(2);
		expect(overlap.results.map(result => result.status)).toEqual(["fulfilled", "fulfilled"]);
		expect(await _FIRST.agentRunTreeReservation.count({ where: { runId: command.runId } })).toBe(1);
		expect(await _FIRST.agentRunTreeAccount.findUnique({ where: { runId: command.runId } })).toMatchObject({ availableModelCalls: 90, availableCostMicros: 900_000n });
		await expect(_RunTreeSqlCommand(_FIRST, async function _AfterStop(_, repository) { return repository.reserve(_reservation(fixture, 1)); })).rejects.toThrow("ancestor no longer accepts work");
		await expect(_RunTreeSqlCommand(_FIRST, async function _SavedReceipt(_, repository) { return repository.reserve(command); })).resolves.toMatchObject({ id: command.reservationId });
	}, 30_000);

	it.each([false, true])("orders branch closure and sibling reservations without deadlock; closure first=%s", async function _BranchClosure(closeFirst)
	{
		const fixture = await _SeedRunTreeSqlFixture(4);
		await _openRoot(fixture);
		await _RunTreeSqlCommand(_FIRST, async function _Branches(_, repository)
		{
			await repository.allocateChild(_child(fixture, 1, 40));
			await repository.allocateChild(_child(fixture, 2, 40));
			await repository.allocateChild(_child(fixture, 3, 20, 1));
		});
		await _RunTreeSqlCommand(_FIRST, async function _BranchStop(transaction) { await _SaveRunTreeSqlStop(transaction, fixture, fixture.runIds[1], fixture.runIds[0]); });
		const close = { siloId: fixture.siloId, runId: fixture.runIds[3], sourceRunId: fixture.runIds[1], reason: RunTreeClosureReasons.AuthorizedStop };
		const reserve = _reservation(fixture, 10, 2);
		const overlap = await _OverlapRunTreeSqlCommands(_FIRST, _SECOND, fixture.runIds[0], async function _FirstCommand(_, repository)
		{
			if (closeFirst)
				return repository.close(close);
			return repository.reserve(reserve);
		}, async function _SecondCommand(_, repository)
		{
			if (closeFirst)
				return repository.reserve(reserve);
			return repository.close(close);
		});
		expect(overlap.backendPids.length).toBeGreaterThanOrEqual(2);
		expect(overlap.secondAttempts).toBeGreaterThanOrEqual(2);
		expect(overlap.results.map(result => result.status)).toEqual(["fulfilled", "fulfilled"]);
		expect(await _FIRST.agentRunTreeAccount.findUnique({ where: { runId: fixture.runIds[2] } })).toMatchObject({ availableModelCalls: 30, closedAt: null });
		expect(await _FIRST.agentRun.findUnique({ where: { id: fixture.runIds[3] } })).toMatchObject({ cancellationCommandId: null });
		await expect(_RunTreeSqlCommand(_FIRST, async function _StoppedDescendant(_, repository) { return repository.reserve(_reservation(fixture, 1, 3)); })).rejects.toThrow("ancestor no longer accepts work");
	}, 30_000);

	it.each([false, true])("prevents overlapping legacy mint and account authority from coexisting; account first=%s", async function _LegacyExclusion(accountFirst)
	{
		const fixture = await _SeedRunTreeSqlFixture(1);
		const command = _root(fixture);
		const overlap = await _OverlapRunTreeSqlCommands(_FIRST, _SECOND, command.runId, async function _FirstAuthority(transaction, repository)
		{
			if (accountFirst)
				return repository.initializeRoot(command);
			return _SaveRunTreeSqlLegacyMint(transaction, fixture, command.runId);
		}, async function _SecondAuthority(transaction, repository)
		{
			if (accountFirst)
				return _SaveRunTreeSqlLegacyMint(transaction, fixture, command.runId);
			return repository.initializeRoot(command);
		});
		expect(overlap.backendPids.length).toBeGreaterThanOrEqual(2);
		expect(overlap.secondAttempts).toBeGreaterThanOrEqual(2);
		expect(overlap.results[0].status).toBe("fulfilled");
		expect(_failureMessage(overlap.results[1])).toContain(accountFirst ? "require reservation-scoped authority" : "cannot adopt existing spending authority");
		const accounts = await _FIRST.agentRunTreeAccount.count({ where: { runId: command.runId } });
		const mints = await _FIRST.runModelCredentialMintAuthorization.count({ where: { runId: command.runId } });
		expect(accounts).toBe(accountFirst ? 1 : 0);
		expect(mints).toBe(accountFirst ? 0 : 1);
	}, 30_000);

	it("rolls back child allocation and local reservation with the caller's complete admission", async function _WholeAdmissionRollback()
	{
		const fixture = await _SeedRunTreeSqlFixture(2);
		await _openRoot(fixture);
		await expect(_RunTreeSqlCommand(_FIRST, async function _FailAfterWrites(_, repository)
		{
			await repository.allocateChild(_child(fixture, 1, 20));
			await repository.reserve(_reservation(fixture, 10));
			throw new Error("synthetic caller admission failure");
		})).rejects.toThrow("synthetic caller admission failure");
		expect(await _SECOND.agentRunTreeAccount.count({ where: { rootRunId: fixture.runIds[0] } })).toBe(1);
		expect(await _SECOND.agentRunTreeReservation.count({ where: { runId: fixture.runIds[0] } })).toBe(0);
		expect(await _SECOND.agentRunTreeAccount.findUnique({ where: { runId: fixture.runIds[0] } })).toMatchObject({ availableModelCalls: 100, availableCompletionTokens: 1000, availableToolInvocations: 100, availableLoopIterations: 100, availableCostMicros: 1_000_000n });
	}, 30_000);
});
