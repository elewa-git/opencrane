import { ElicitationPurpose, ToolInvocationState, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PERSONAL_MEMORY_RECALL_TOOL_REVISION } from "@opencrane/models/agents";

import { PrismaRuntimeCommandDecisionUnitOfWork } from "../prisma-runtime-command-decision-unit-of-work";
import { RuntimeWaitReasons } from "../runtime-wait-reasons.types";

/** Build the two query methods used by the wait-reason read. */
function _Transaction(invocations: readonly { readonly state: ToolInvocationState; readonly toolRevisionId: string }[], purposes: readonly ElicitationPurpose[]): Prisma.TransactionClient
{
	return {
		toolInvocation: { findMany: vi.fn().mockResolvedValue(invocations) },
		elicitationRequest: { findMany: vi.fn().mockResolvedValue(purposes.map(function _Request(purpose) { return { purpose }; })) },
	} as unknown as Prisma.TransactionClient;
}

describe("runtime command wait reasons", function _Suite()
{
	it("keeps ordinary outside work separate from server-proven approvals and participant input", async function _Classifies()
	{
		const transaction = _Transaction([
			{ state: ToolInvocationState.Ready, toolRevisionId: "tool:ordinary:v1" },
			{ state: ToolInvocationState.AwaitingApproval, toolRevisionId: "tool:approved:v1" },
			{ state: ToolInvocationState.AwaitingApproval, toolRevisionId: PERSONAL_MEMORY_RECALL_TOOL_REVISION },
			{ state: ToolInvocationState.RecoveryRequired, toolRevisionId: "tool:unclear:v1" },
		], [ElicitationPurpose.RuntimeInput, ElicitationPurpose.A2uiAction, ElicitationPurpose.ToolApproval, ElicitationPurpose.PersonalMemoryPermission]);
		const unitOfWork = new PrismaRuntimeCommandDecisionUnitOfWork(transaction);

		const reasons = await unitOfWork.readWaitReasons({ runId: "run-1", attempt: 2, runState: "waiting_for_input" });

		expect(reasons).toEqual([RuntimeWaitReasons.ExternalAction, RuntimeWaitReasons.RuntimeInput, RuntimeWaitReasons.A2uiAction, RuntimeWaitReasons.ToolApproval, RuntimeWaitReasons.PersonalMemoryPermission, RuntimeWaitReasons.RecoveryRequired]);
		expect(transaction.toolInvocation.findMany).toHaveBeenCalledWith({ where: { runId: "run-1", attempt: 2, state: { notIn: [ToolInvocationState.Succeeded, ToolInvocationState.Failed] } }, select: { state: true, toolRevisionId: true } });
	});

	it("does not infer a wait from rows after the run leaves its waiting state", async function _NotWaiting()
	{
		const transaction = _Transaction([{ state: ToolInvocationState.AwaitingApproval, toolRevisionId: "tool:approved:v1" }], [ElicitationPurpose.ToolApproval]);
		const unitOfWork = new PrismaRuntimeCommandDecisionUnitOfWork(transaction);

		await expect(unitOfWork.readWaitReasons({ runId: "run-1", attempt: 2, runState: "running" })).resolves.toEqual([]);
		expect(transaction.toolInvocation.findMany).not.toHaveBeenCalled();
		expect(transaction.elicitationRequest.findMany).not.toHaveBeenCalled();
	});
});
