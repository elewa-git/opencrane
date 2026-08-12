import { AgentRunState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ToolInvocationRunRecoveryEnterResults } from "@opencrane/backend/server/iam/authorization";

import { PrismaToolInvocationRunRecoveryAuthority } from "../prisma-tool-invocation-run-recovery-authority.js";

/** Create the minimum transaction fake for exact run recovery state transitions. */
function _Transaction(updateCount: number, current: { readonly attempt: number; readonly state: AgentRunState } | null)
{
	return { agentRun: { updateMany: vi.fn().mockResolvedValue({ count: updateCount }), findUnique: vi.fn().mockResolvedValue(current) } };
}

describe("PrismaToolInvocationRunRecoveryAuthority", function _DescribeRunRecoveryAuthority()
{
	it("enters RecoveryRequired from the exact running attempt", async function _EnterRecovery()
	{
		const transaction = _Transaction(1, null);
		const authority = new PrismaToolInvocationRunRecoveryAuthority();

		await expect(authority.enterRecoveryRequiredInTransaction(transaction, { runId: "run-1", attempt: 2 })).resolves.toBe(ToolInvocationRunRecoveryEnterResults.Entered);
		expect(transaction.agentRun.updateMany).toHaveBeenCalledWith({ where: { id: "run-1", attempt: 2, state: AgentRunState.Running }, data: { state: AgentRunState.RecoveryRequired } });
	});

	it("accepts an exact already-entered recovery state", async function _AcceptEnteredRecovery()
	{
		const transaction = _Transaction(0, { attempt: 2, state: AgentRunState.RecoveryRequired });
		const authority = new PrismaToolInvocationRunRecoveryAuthority();

		await expect(authority.enterRecoveryRequiredInTransaction(transaction, { runId: "run-1", attempt: 2 })).resolves.toBe(ToolInvocationRunRecoveryEnterResults.AlreadyRecoveryRequired);
	});

	it("resumes only the exact recovery-required attempt", async function _ResumeRunning()
	{
		const transaction = _Transaction(1, null);
		const authority = new PrismaToolInvocationRunRecoveryAuthority();

		await expect(authority.resumeRunningInTransaction(transaction, { runId: "run-1", attempt: 2 })).resolves.toBe(true);
		expect(transaction.agentRun.updateMany).toHaveBeenCalledWith({ where: { id: "run-1", attempt: 2, state: AgentRunState.RecoveryRequired }, data: { state: AgentRunState.Running } });
	});

	it("does not cross a cancelling run", async function _RejectCancellingRun()
	{
		const transaction = _Transaction(0, { attempt: 2, state: AgentRunState.Cancelling });
		const authority = new PrismaToolInvocationRunRecoveryAuthority();

		await expect(authority.enterRecoveryRequiredInTransaction(transaction, { runId: "run-1", attempt: 2 })).resolves.toBe(ToolInvocationRunRecoveryEnterResults.Cancelling);
		await expect(authority.resumeRunningInTransaction(transaction, { runId: "run-1", attempt: 2 })).resolves.toBe(false);
	});

	it("distinguishes a stale attempt from cancellation", async function _RejectStaleAttempt()
	{
		const transaction = _Transaction(0, { attempt: 3, state: AgentRunState.RecoveryRequired });
		const authority = new PrismaToolInvocationRunRecoveryAuthority();

		await expect(authority.enterRecoveryRequiredInTransaction(transaction, { runId: "run-1", attempt: 2 })).resolves.toBe(ToolInvocationRunRecoveryEnterResults.Conflict);
	});
});
