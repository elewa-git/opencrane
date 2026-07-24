import { describe, expect, it, vi } from "vitest";

import { PrismaRevisionBudgetPolicySource } from "../prisma-revision-budget-policy-source.js";

/** Returns the one root-run authority already accepted by the session assembler. */
function _run()
{
	return { agentServiceId: "service-1", agentRevisionId: "revision-1", agentKind: "personal", effectiveContractDigest: "sha256:contract", promptCompilerVersion: "prompt-v1", trigger: "interactive", delegatedUserId: "user-1", rootRunId: "run-1", parentRunId: null } as const;
}

/** Wraps one controlled revision row in the final-admission transaction shape. */
function _transaction(revision: unknown, admittedAtEpochMs = 1_000)
{
	return { prisma: { $queryRaw: vi.fn().mockResolvedValue([]), agentRevision: { findFirst: vi.fn().mockResolvedValue(revision) } }, admittedAt: "2026-07-24T00:00:00.000Z", admittedAtEpochMs } as never;
}

describe("PrismaRevisionBudgetPolicySource", function _describeRevisionBudgetPolicySource()
{
	it("freezes all revision ceilings into the runtime budget policy", async function _loadsBudget()
	{
		const transaction = _transaction({ budget: { maxTurns: 4, maxTokens: 1000, maxCostUsdMicros: 500_000, maxDurationMs: 60_000 } });
		const result = await new PrismaRevisionBudgetPolicySource().load({ runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", threadId: "thread-1", executionSubjectId: "user-1", requestIdempotencyKey: "request-1" }, _run(), transaction);

		expect(result).toEqual({ outcome: "loaded", value: { budgetPolicy: { maxTurns: 4, maxTotalTokens: 1000, maxCostUsdMicros: 500_000, maxToolInvocations: null, wallClockDeadlineEpochMs: 61_000 } } });
	});

	it("refuses missing, incomplete, or overflowed budgets before snapshot persistence", async function _refusesBadBudget()
	{
		const command = { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", threadId: "thread-1", executionSubjectId: "user-1", requestIdempotencyKey: "request-1" } as const;
		const source = new PrismaRevisionBudgetPolicySource();
		await expect(source.load(command, _run(), _transaction(null))).resolves.toEqual({ outcome: "denied", reason: "budget_unavailable" });
		await expect(source.load(command, _run(), _transaction({ budget: { maxTurns: 4, maxTokens: 1000, maxDurationMs: 60_000 } }))).resolves.toEqual({ outcome: "denied", reason: "budget_unavailable" });
		await expect(source.load(command, _run(), _transaction({ budget: { maxTurns: 4, maxTokens: 1000, maxCostUsdMicros: 500_000, maxDurationMs: Number.MAX_SAFE_INTEGER } }, 1))).resolves.toEqual({ outcome: "denied", reason: "budget_unavailable" });
	});
});
