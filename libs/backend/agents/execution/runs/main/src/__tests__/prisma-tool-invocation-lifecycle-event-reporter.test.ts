import { AgentRunState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ToolInvocationEventTypes } from "@opencrane/backend/server/iam/authorization";

import { PrismaToolInvocationLifecycleEventUnitOfWork } from "../prisma-tool-invocation-lifecycle-event-reporter";

/** Build one transaction double with an exact active conversation run. */
function _transaction(state: AgentRunState = AgentRunState.Running)
{
	return {
		agentRun: { findUnique: vi.fn().mockResolvedValue({ id: "run-1", attempt: 2, state, conversationId: "conversation-1" }) },
	};
}

describe("Prisma tool invocation lifecycle event reporter", function _suite()
{
	it("admits one bounded start event for the exact running attempt", async function _started()
	{
		const transaction = _transaction();
		const reporter = new PrismaToolInvocationLifecycleEventUnitOfWork({ $transaction: vi.fn(async function _run(work: (value: unknown) => Promise<unknown>) { return work(transaction); }) } as never);

		await expect(reporter.append({ runId: "run-1", attempt: 2, eventType: ToolInvocationEventTypes.Started, payload: { toolInvocationId: "call-1" } })).resolves.toBeUndefined();
		expect(transaction.agentRun.findUnique).toHaveBeenCalledWith({ where: { id: "run-1" } });
	});

	it("fails closed when the run has moved to another attempt", async function _staleAttempt()
	{
		const transaction = _transaction();
		const reporter = new PrismaToolInvocationLifecycleEventUnitOfWork({ $transaction: vi.fn(async function _run(work: (value: unknown) => Promise<unknown>) { return work(transaction); }) } as never);

		await expect(reporter.append({ runId: "run-1", attempt: 1, eventType: ToolInvocationEventTypes.Started, payload: { toolInvocationId: "call-1" } })).rejects.toThrow("tool lifecycle event is no longer valid for the run attempt");
	});

	it("accepts a recovery transaction's safe retry-visible failure", async function _recoveryFailure()
	{
		const transaction = _transaction(AgentRunState.RecoveryRequired);
		const reporter = new PrismaToolInvocationLifecycleEventUnitOfWork({} as never);

		await expect(reporter.appendInTransaction(transaction, { runId: "run-1", attempt: 2, eventType: ToolInvocationEventTypes.Failed, payload: { toolInvocationId: "call-1", toolRevisionId: "revision-1", reason: "external_action_provider_outcome_ambiguous", retryCount: 1, retryLimit: 3, retrying: false } })).resolves.toBe(true);
	});

	it("rejects secret-shaped free-form failure text", async function _rejectsSecretText()
	{
		const reporter = new PrismaToolInvocationLifecycleEventUnitOfWork({} as never);

		await expect(reporter.appendInTransaction(_transaction(), { runId: "run-1", attempt: 2, eventType: ToolInvocationEventTypes.Failed, payload: { toolInvocationId: "call-1", toolRevisionId: "revision-1", reason: "token=secret", retryCount: 1, retryLimit: 3, retrying: false } })).resolves.toBe(false);
	});
});
