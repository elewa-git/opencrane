import { Prisma, ToolInvocationState } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { RunToolProgressPhases } from "@opencrane/contracts";

import { PrismaSelfRunStatusRepository, PrismaSelfRunStatusUnitOfWork } from "../prisma-self-run-status-repository";

/** Creates the selected persisted fields for one owner-visible run. */
function _RunRow()
{
	return { id: "run-1", attempt: 2, state: "Running", conversationId: "conversation-1", agentRevisionId: "revision-1", acceptedAt: new Date("2026-07-26T12:00:00.000Z"), finishedAt: null };
}

/** Keeps owner selection, central Read permission and the IAM projection on the same transaction double. */
function _Fixture()
{
	const row = _RunRow();
	const transaction = { agentRun: { findMany: vi.fn().mockResolvedValue([row]), findFirst: vi.fn().mockResolvedValue(row) }, toolInvocation: { findFirst: vi.fn().mockResolvedValue({ state: ToolInvocationState.Succeeded }) } };
	const listPrincipalEntitled = vi.fn().mockImplementation(async function _Allow(command)
	{
		expect(transaction.toolInvocation.findFirst).not.toHaveBeenCalled();
		return command.resources;
	});
	const repository = new PrismaSelfRunStatusRepository(transaction as never, { listPrincipalEntitled });
	const caller = { siloId: "silo-1", principalId: "principal-1" };
	return { row, transaction, listPrincipalEntitled, repository, caller };
}

afterEach(function _Restore() { vi.restoreAllMocks(); });

describe("Prisma self run status projection", function _Suite()
{
	it("reads the latest current-attempt phase only after owner filtering and central Read authorization", async function _AuthorizedList()
	{
		const f = _Fixture();
		const result = await f.repository.listOwned(f.caller);
		expect(result).toEqual([{ runId: "run-1", attempt: 2, state: "running", latestTool: { phase: RunToolProgressPhases.ResultReceived }, conversationId: "conversation-1", agentRevisionId: "revision-1", acceptedAt: "2026-07-26T12:00:00.000Z", finishedAt: null }]);
		expect(f.transaction.agentRun.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { siloId: "silo-1", principalId: { equals: "principal-1" } }, orderBy: [{ acceptedAt: "desc" }, { id: "desc" }], take: 200 }));
		expect(f.listPrincipalEntitled).toHaveBeenCalledWith(expect.objectContaining({ ...f.caller, action: "read", resources: [{ kind: "agent-run", id: "run-1" }] }));
		expect(f.transaction.toolInvocation.findFirst).toHaveBeenCalledExactlyOnceWith({ where: { siloId: "silo-1", runId: "run-1", attempt: 2, mcpTaskId: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { state: true } });
	});

	it("uses the same phase contract for detail without making a successful tool a completed run", async function _Detail()
	{
		const f = _Fixture();
		await expect(f.repository.readOwned(f.caller, "run-1")).resolves.toMatchObject({ state: "running", finishedAt: null, latestTool: { phase: RunToolProgressPhases.ResultReceived } });
		expect(f.transaction.agentRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "run-1", siloId: "silo-1", principalId: { equals: "principal-1" } } }));
	});

	it("does not query invocation state for a foreign, absent or unentitled run", async function _Denied()
	{
		const f = _Fixture();
		f.transaction.agentRun.findFirst.mockResolvedValue(null);
		await expect(f.repository.readOwned(f.caller, "foreign")).resolves.toBeNull();
		expect(f.listPrincipalEntitled).not.toHaveBeenCalled();
		f.transaction.agentRun.findFirst.mockResolvedValue(f.row);
		f.listPrincipalEntitled.mockResolvedValue([]);
		await expect(f.repository.readOwned(f.caller, "run-1")).resolves.toBeNull();
		await expect(f.repository.listOwned(f.caller)).resolves.toEqual([]);
		expect(f.transaction.toolInvocation.findFirst).not.toHaveBeenCalled();
	});

	it("bounds phase reads to the final fifty authorized runs", async function _Bounded()
	{
		const f = _Fixture();
		const rows = Array.from({ length: 200 }, (_, index) => ({ ...f.row, id: `run-${index}` }));
		f.transaction.agentRun.findMany.mockResolvedValue(rows);
		f.listPrincipalEntitled.mockImplementation(async command => command.resources.slice(80));
		const result = await f.repository.listOwned(f.caller);
		expect(result).toHaveLength(50);
		expect(f.transaction.toolInvocation.findFirst).toHaveBeenCalledTimes(50);
		expect(f.transaction.toolInvocation.findFirst.mock.calls.map(call => call[0].where.runId)).toEqual(rows.slice(80, 130).map(row => row.id));
	});

	it("returns null progress for an empty current attempt and propagates errors", async function _EmptyAttempt()
	{
		const f = _Fixture();
		f.transaction.toolInvocation.findFirst.mockResolvedValue(null);
		await expect(f.repository.readOwned(f.caller, "run-1")).resolves.toMatchObject({ latestTool: null });
		f.transaction.toolInvocation.findFirst.mockClear().mockRejectedValue(new Error("phase read failed"));
		await expect(f.repository.listOwned(f.caller)).rejects.toThrow("phase read failed");
	});

	it("uses the same RepeatableRead transaction for the owned row, current permission and IAM state", async function _Transaction()
	{
		const f = _Fixture();
		vi.spyOn(PrismaAuthorizationAuthority.prototype, "listPrincipalEntitled").mockImplementation(f.listPrincipalEntitled);
		const $transaction = vi.fn().mockImplementation(async operation => await operation(f.transaction));
		const unit = new PrismaSelfRunStatusUnitOfWork({ $transaction } as never);
		await expect(unit.readOwned(f.caller, "run-1")).resolves.toMatchObject({ latestTool: { phase: RunToolProgressPhases.ResultReceived } });
		expect($transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
		expect(f.transaction.agentRun.findFirst).toHaveBeenCalledTimes(1);
		expect(f.listPrincipalEntitled).toHaveBeenCalledTimes(1);
		expect(f.transaction.toolInvocation.findFirst).toHaveBeenCalledTimes(1);
	});
});
