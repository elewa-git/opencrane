import { ActionExecutionState, type PrismaClient } from "@prisma/client";

import type { Logger } from "@opencrane/observability";

import { __DeferToolRequest } from "./deferred-tool-approval.js";
import type { OpenDeferredToolApprovalCommand } from "./deferred-tool-approval.types.js";
import { PrismaToolInvocationRepository } from "./prisma-tool-invocation-repository.js";

/**
 * Open a pending approval for one reserved tool invocation without stranding replayable work.
 *
 * The create and unavailable-terminalisation paths share one transaction. If the transaction throws
 * after the database may have committed, the recovery read first treats a linked approval as proof
 * of success; only an unlinked reservation is compare-and-set to Failed. This keeps every
 * post-reservation ambiguity terminal and prevents a runtime replay from dispatching the action.
 *
 * @param prisma - Canonical authorization persistence client.
 * @param command - Exact reserved invocation, effective policy, and server-owned time bounds.
 * @param logger - Structured logger used when ambiguous recovery needs operator attention.
 * @returns True when an approval exists, otherwise false after best-effort terminalisation.
 * @throws When neither approval existence nor reservation terminalisation can be proven.
 */
export async function __OpenDeferredToolApproval(prisma: PrismaClient, command: OpenDeferredToolApprovalCommand, logger: Logger): Promise<boolean>
{
	const repository = new PrismaToolInvocationRepository(prisma);
	try
	{
		return await prisma.$transaction(async function _defer(transaction): Promise<boolean>
		{
			// 1. Create the approval against the same live workload and proof-key fence as the run.
			const result = await __DeferToolRequest(transaction, {
				runId: command.runId,
				attempt: command.attempt,
				toolInvocationRowId: command.reservationId,
				toolRevisionId: command.toolRevisionId,
				argumentsDigest: command.argumentsDigest,
				actionDigest: command.toolInvocationId,
				effectivePolicyDigest: command.capabilitySetDigest,
				approverPolicyRevision: "mcp-server-requires-approval",
				now: command.now,
				expiresAt: command.expiresAt,
			});
			if (result.outcome !== "unavailable") return true;

			// 2. A missing live workload makes the reserved invocation terminal in the same commit.
			const failed = await transaction.toolInvocation.updateMany({ where: { id: command.reservationId, state: ActionExecutionState.Reserved }, data: { state: ActionExecutionState.Failed, failureCode: "approval_unavailable", completedAt: command.now } });
			if (failed.count !== 1) throw new Error("deferred approval lost its reserved invocation fence");
			return false;
		});
	}
	catch (transactionError)
	{
		const evidence = { runId: command.runId, attempt: command.attempt, reservationId: command.reservationId, toolInvocationId: command.toolInvocationId };
		logger.warn({ err: transactionError, ...evidence }, "deferred approval transaction outcome is ambiguous");

		// 3. A linked approval proves an ambiguous transaction committed before its connection failed.
		try
		{
			const approval = await prisma.approvalRequest.findFirst({ where: { runId: command.runId, attempt: command.attempt, actionDigest: command.toolInvocationId, toolInvocationRowId: command.reservationId } });
			if (approval !== null) return true;
		}
		catch (recoveryReadError)
		{
			logger.error({ err: recoveryReadError, ...evidence }, "deferred approval recovery read failed");
		}

		// 4. Otherwise close the reservation so the same side effect can never be replayed ambiguously.
		try
		{
			await repository.markFailed(command.reservationId, "approval_defer_failed");
			return false;
		}
		catch (terminalisationError)
		{
			logger.error({ err: terminalisationError, transactionError, ...evidence }, "deferred approval recovery could not terminalise reserved invocation");
			throw new Error("deferred approval recovery could not terminalise reserved invocation", { cause: terminalisationError });
		}
	}
}
