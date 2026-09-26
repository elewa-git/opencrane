import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { AuthorizationAuthority, ManagedAuthorizationGrantRepository, ManagedAuthorizationGrantRestrictionRepository } from "@opencrane/backend/server/iam/authorization";
import { AgentRunStates, RoutineFiringDisposition } from "@opencrane/models/agents";

import { PrismaRoutineUnitOfWork } from "../prisma-routine-unit-of-work";
import type { RoutineTaskAdmissionPort } from "../routine-workflow.types";
import { _CALLER, _TaskAdmission } from "./prisma-routine-test-fixtures";

describe("PrismaRoutineUnitOfWork", function _Suite()
{
	it("records historical progress in a serializable transaction without fresh grants", async function _ProgressTransaction()
	{
		const transaction = {
			agentRun: { findFirst: vi.fn().mockResolvedValue({ id: "run-1" }) },
			agentRoutineFiring: { findFirst: vi.fn().mockResolvedValue({ disposition: "Running", resultReference: null, resultDigest: null }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			agentRunAuthorityClock: { findUnique: vi.fn().mockResolvedValue({ now: new Date("2026-09-26T12:00:00.000Z") }) },
		} as unknown as Prisma.TransactionClient;
		const transact = vi.fn(async function _Transaction<Result>(operation: (client: Prisma.TransactionClient) => Promise<Result>, _options?: { readonly isolationLevel?: Prisma.TransactionIsolationLevel }) { return await operation(transaction); });
		const authorization = vi.fn();
		const managedGrants = vi.fn();
		const tasks = _TaskAdmission();
		const unit = new PrismaRoutineUnitOfWork({ $transaction: transact } as unknown as PrismaClient, { authorization, managedGrants, taskAdmission: tasks as unknown as RoutineTaskAdmissionPort<Prisma.TransactionClient> });
		await unit.recordRunProgress({ siloId: "silo-1", routineId: "routine-1", routineRevision: 1, firingId: "firing-1", runId: "run-1", attempt: 1, inputSnapshotDigest: `sha256:${"1".repeat(64)}`, sourceState: AgentRunStates.Running, sourceFinishedAt: null, sourceTerminalReason: null, sourceCancellationCommandId: null, sourceCancellationCommandDigest: null, disposition: RoutineFiringDisposition.Waiting, resultReference: null, resultDigest: null });
		expect(transact).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: undefined, maxWait: undefined });
		expect(transaction.agentRoutineFiring.updateMany).toHaveBeenCalledOnce();
		expect(authorization).not.toHaveBeenCalled();
		expect(managedGrants).not.toHaveBeenCalled();
		expect(tasks.admitSchedule).not.toHaveBeenCalled();
		expect(tasks.admitOccurrence).not.toHaveBeenCalled();
	});

	it("builds command and firing repositories over each serializable callback transaction", async function _TransactionOwnership()
	{
		const transaction = {
			agentRoutine: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
		} as unknown as Prisma.TransactionClient;
		const transact = vi.fn(async function _Transaction<Result>(operation: (client: Prisma.TransactionClient) => Promise<Result>, _options?: { readonly isolationLevel?: Prisma.TransactionIsolationLevel; readonly timeout?: number; readonly maxWait?: number }) { return await operation(transaction); });
		const authorization = vi.fn().mockReturnValue({});
		const managedGrants = vi.fn().mockReturnValue({ reconcileManagedResourceGrants: vi.fn(), restrictManagedResourceGrants: vi.fn() });
		const unit = new PrismaRoutineUnitOfWork({ $transaction: transact } as unknown as PrismaClient, {
			authorization: authorization as unknown as (client: Prisma.TransactionClient) => AuthorizationAuthority,
			managedGrants: managedGrants as unknown as (client: Prisma.TransactionClient) => ManagedAuthorizationGrantRepository & ManagedAuthorizationGrantRestrictionRepository,
			taskAdmission: _TaskAdmission() as unknown as RoutineTaskAdmissionPort<Prisma.TransactionClient>,
		});

		await expect(unit.read({ caller: _CALLER, routineId: "missing-routine" })).resolves.toBeNull();
		await expect(unit.repairActiveSchedulesPage({ siloId: "silo-1", limit: 10, afterRoutineId: null })).resolves.toEqual({ checked: 0, nextCursor: null });
		expect(transact).toHaveBeenCalledTimes(2);
		for (const call of transact.mock.calls)
		{
			expect(call[1]).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: undefined, maxWait: undefined });
		}
		expect(authorization).toHaveBeenCalledTimes(2);
		expect(authorization).toHaveBeenNthCalledWith(1, transaction);
		expect(authorization).toHaveBeenNthCalledWith(2, transaction);
		expect(managedGrants).toHaveBeenCalledOnce();
		expect(managedGrants).toHaveBeenCalledWith(transaction);
	});
});
