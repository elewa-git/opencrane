import { AgentRunState, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaToolRecoveryEventReporter } from "../prisma-tool-recovery-event-reporter";

/** Build the transaction seam needed by the recovery reporter. */
function _transaction(run: unknown): Prisma.TransactionClient
{
	return { agentRun: { findUnique: vi.fn().mockResolvedValue(run) } } as unknown as Prisma.TransactionClient;
}

describe("PrismaToolRecoveryEventReporter", function _suite()
{
	it("admits a recovery for the exact recovery-required attempt", async function _admits()
	{
		const transaction = _transaction({ id: "run-1", attempt: 2, state: AgentRunState.RecoveryRequired, conversationId: "conversation-1" });
		await expect(new PrismaToolRecoveryEventReporter().appendInTransaction(transaction, { runId: "run-1", expectedAttempt: 2, toolInvocationId: "tool-1", preparationRetryCount: 1, preparationRetryLimit: 3, providerOutcome: "unknown_after_dispatch" })).resolves.toBe(true);
	});

	it("rejects stale attempts and wrong run states", async function _rejects()
	{
		const transaction = _transaction({ id: "run-1", attempt: 3, state: AgentRunState.Running, conversationId: "conversation-1" });
		await expect(new PrismaToolRecoveryEventReporter().appendInTransaction(transaction, { runId: "run-1", expectedAttempt: 2, toolInvocationId: "tool-1", preparationRetryCount: 1, preparationRetryLimit: 3, providerOutcome: "unknown_after_dispatch" })).resolves.toBe(false);
	});
});
