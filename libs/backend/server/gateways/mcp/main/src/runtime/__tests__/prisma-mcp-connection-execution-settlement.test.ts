import { McpExecutorCommandState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ToolInvocationStates } from "@opencrane/backend/server/iam/authorization";

import { PrismaMcpConnectionExecutionSettlementUnitOfWork } from "../prisma-mcp-connection-execution-settlement-unit-of-work";

const _NOW = new Date("2026-09-12T12:00:00.000Z");
const _RECORD = { id: "connection-1", siloId: "silo-1", serverId: "server-1", ownerPrincipalId: "principal-1", generation: 3, endpointDigest: `sha256:${"a".repeat(64)}` } as const;

/** Build the transaction and ToolInvocation participant observed by settlement tests. */
function _Harness(executions: ReadonlyArray<{ readonly id: string; readonly commandState: McpExecutorCommandState; readonly toolInvocationId: string | null }>)
{
	const invocation = { id: "invocation-1", revision: 4, state: ToolInvocationStates.Ready };
	const participant = {
		findById: vi.fn().mockResolvedValue(invocation),
		completeUnusedBeforeDispatch: vi.fn().mockResolvedValue({ changed: true, invocation: { ...invocation, state: ToolInvocationStates.Failed } }),
	};
	const transaction = {
		mcpRuntimeExecution: {
			findMany: vi.fn().mockResolvedValue(executions),
			updateMany: vi.fn().mockResolvedValue({ count: 1 }),
			count: vi.fn().mockResolvedValue(0),
		},
		mcpRuntimeClock: { findUnique: vi.fn().mockResolvedValue({ singleton: 1, now: _NOW }) },
	};
	const prisma = { $transaction: vi.fn().mockImplementation(async function _Transaction(operation) { return operation(transaction); }) };
	const toolInvocations = { __ForTransaction: vi.fn().mockReturnValue(participant) };
	return { prisma, transaction, toolInvocations, participant };
}

describe("remote MCP connection execution settlement", function _Suite()
{
	it("closes an unused invocation before allowing credential cleanup", async function _ClosesUnused()
	{
		const harness = _Harness([{ id: "execution-1", commandState: McpExecutorCommandState.Pending, toolInvocationId: "invocation-1" }]);
		const settlement = new PrismaMcpConnectionExecutionSettlementUnitOfWork(harness.prisma as never, harness.toolInvocations as never);

		await expect(settlement.isSettled(_RECORD as never)).resolves.toBe(true);

		expect(harness.participant.completeUnusedBeforeDispatch).toHaveBeenCalledExactlyOnceWith("invocation-1", 4, "mcp_connection_revoked_before_dispatch", _NOW);
		expect(harness.transaction.mcpRuntimeExecution.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ commandState: McpExecutorCommandState.Failed, completedAt: _NOW }) }));
	});

	it("keeps cleanup waiting while a provider dispatch claim is unresolved", async function _WaitsForClaim()
	{
		const harness = _Harness([{ id: "execution-1", commandState: McpExecutorCommandState.Claimed, toolInvocationId: "invocation-1" }]);
		const settlement = new PrismaMcpConnectionExecutionSettlementUnitOfWork(harness.prisma as never, harness.toolInvocations as never);

		await expect(settlement.isSettled(_RECORD as never)).resolves.toBe(false);

		expect(harness.participant.completeUnusedBeforeDispatch).not.toHaveBeenCalled();
		expect(harness.transaction.mcpRuntimeExecution.updateMany).not.toHaveBeenCalled();
	});

	it("throws after a lost runtime fence so the ToolInvocation write rolls back", async function _RollsBackLostRuntimeFence()
	{
		const harness = _Harness([{ id: "execution-1", commandState: McpExecutorCommandState.Pending, toolInvocationId: "invocation-1" }]);
		harness.transaction.mcpRuntimeExecution.updateMany.mockResolvedValue({ count: 0 });
		const settlement = new PrismaMcpConnectionExecutionSettlementUnitOfWork(harness.prisma as never, harness.toolInvocations as never);

		await expect(settlement.isSettled(_RECORD as never)).rejects.toThrow("remote MCP settlement lost its runtime transition");

		expect(harness.participant.completeUnusedBeforeDispatch).toHaveBeenCalledOnce();
	});

	it("accepts saved terminal evidence without rewriting it", async function _AcceptsTerminal()
	{
		const harness = _Harness([{ id: "execution-1", commandState: McpExecutorCommandState.RecoveryRequired, toolInvocationId: "invocation-1" }]);
		const settlement = new PrismaMcpConnectionExecutionSettlementUnitOfWork(harness.prisma as never, harness.toolInvocations as never);

		await expect(settlement.isSettled(_RECORD as never)).resolves.toBe(true);

		expect(harness.participant.completeUnusedBeforeDispatch).not.toHaveBeenCalled();
		expect(harness.transaction.mcpRuntimeExecution.updateMany).not.toHaveBeenCalled();
	});
});
