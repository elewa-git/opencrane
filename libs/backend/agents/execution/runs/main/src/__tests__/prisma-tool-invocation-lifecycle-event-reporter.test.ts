import { AgentRunState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ToolInvocationEventTypes } from "@opencrane/backend/server/iam/authorization";

import { PrismaToolInvocationLifecycleEventUnitOfWork } from "../prisma-tool-invocation-lifecycle-event-reporter";

/** Build one transaction double with an exact active conversation run. */
function _transaction(state: AgentRunState = AgentRunState.Running)
{
	return {
		agentRun: { findUnique: vi.fn().mockResolvedValue({ id: "run-1", attempt: 2, state, conversationId: "conversation-1" }) },
		conversationRunEvent: { aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 4 } }), create: vi.fn().mockResolvedValue({}) },
	};
}

describe("Prisma tool invocation lifecycle event reporter", function _suite()
{
	it("appends one bounded start event for the exact running attempt", async function _started()
	{
		const transaction = _transaction();
		const reporter = new PrismaToolInvocationLifecycleEventUnitOfWork({ $transaction: vi.fn(async function _run(work: (value: unknown) => Promise<unknown>) { return work(transaction); }) } as never);

		await expect(reporter.append({ runId: "run-1", attempt: 2, eventType: ToolInvocationEventTypes.Started, payload: { toolInvocationId: "call-1" } })).resolves.toBeUndefined();
		expect(transaction.conversationRunEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ conversationId: "conversation-1", runId: "run-1", attempt: 2, sequence: 5, type: "tool.started", payload: { toolInvocationId: "call-1" } }) });
	});

	it("accepts a recovery transaction's safe retry-visible failure", async function _recoveryFailure()
	{
		const transaction = _transaction(AgentRunState.RecoveryRequired);
		const reporter = new PrismaToolInvocationLifecycleEventUnitOfWork({} as never);

		await expect(reporter.appendInTransaction(transaction, { runId: "run-1", attempt: 2, eventType: ToolInvocationEventTypes.Failed, payload: { toolInvocationId: "call-1", toolRevisionId: "revision-1", reason: "external_action_provider_outcome_ambiguous", retryCount: 1, retryLimit: 3, retrying: false } })).resolves.toBe(true);
		expect(transaction.conversationRunEvent.create).toHaveBeenCalledOnce();
	});

	it("rejects secret-shaped free-form failure text", async function _rejectsSecretText()
	{
		const reporter = new PrismaToolInvocationLifecycleEventUnitOfWork({} as never);

		await expect(reporter.appendInTransaction(_transaction(), { runId: "run-1", attempt: 2, eventType: ToolInvocationEventTypes.Failed, payload: { toolInvocationId: "call-1", toolRevisionId: "revision-1", reason: "token=secret", retryCount: 1, retryLimit: 3, retrying: false } })).resolves.toBe(false);
	});
});
