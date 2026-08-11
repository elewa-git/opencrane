import { AgentRunState, AgentRunTerminalReason } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaRuntimeTerminalReporter } from "../prisma-runtime-terminal-reporter.js";

/** Builds the minimum direct run row needed by the terminal reporting authority. */
function _run(overrides: Record<string, unknown> = {})
{
	return { id: "run-1", attempt: 1, state: AgentRunState.Running, conversationId: "conversation-1", parentRunId: null, ...overrides };
}

/** Builds one transaction double that exposes only terminal reporter dependencies. */
function _transaction(run: ReturnType<typeof _run> | null, updateCount = 1, unresolvedInvocations = 0, pendingResults = 0)
{
	return {
		$queryRaw: vi.fn().mockResolvedValue([]),
		agentRun: { findUnique: vi.fn().mockResolvedValue(run), updateMany: vi.fn().mockResolvedValue({ count: updateCount }) },
		toolInvocation: { count: vi.fn().mockResolvedValue(unresolvedInvocations) },
		toolResultDelivery: { count: vi.fn().mockResolvedValue(pendingResults) },
		conversationRunEvent: { aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 4 } }), create: vi.fn().mockResolvedValue({}) },
	};
}

describe("PrismaRuntimeTerminalReporter", function _describeReporter()
{
	it("commits a fenced runtime success and its canonical stream event together", async function _reportsCompletion()
	{
		const transaction = _transaction(_run());
		const reporter = new PrismaRuntimeTerminalReporter();

		await expect(reporter.reportInTransaction(transaction as never, { runId: "run-1", attempt: 1, eventType: "run.completed" })).resolves.toEqual({ outcome: "reported" });
		expect(transaction.agentRun.updateMany).toHaveBeenCalledWith({ where: { id: "run-1", attempt: 1, state: AgentRunState.Running }, data: expect.objectContaining({ state: AgentRunState.Completed, terminalReason: AgentRunTerminalReason.Success }) });
		expect(transaction.conversationRunEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ conversationId: "conversation-1", runId: "run-1", sequence: 5, type: "run.completed", payload: { terminalReason: "success" } }) });
	});

	it("refuses success while an external action or saved result is unresolved", async function _deniesPrematureSuccess()
	{
		const transaction = _transaction(_run(), 1, 1, 1);
		const reporter = new PrismaRuntimeTerminalReporter();

		await expect(reporter.reportInTransaction(transaction as never, { runId: "run-1", attempt: 1, eventType: "run.completed" })).resolves.toEqual({ outcome: "denied", reason: "tool_results_pending" });
		expect(transaction.agentRun.updateMany).not.toHaveBeenCalled();
	});

	it("refuses a report after cancellation or another terminal writer won", async function _deniesStaleReport()
	{
		const transaction = _transaction(_run({ state: AgentRunState.Cancelling }));
		const reporter = new PrismaRuntimeTerminalReporter();

		await expect(reporter.reportInTransaction(transaction as never, { runId: "run-1", attempt: 1, eventType: "run.failed" })).resolves.toEqual({ outcome: "denied", reason: "run_not_running" });
		expect(transaction.agentRun.updateMany).not.toHaveBeenCalled();
		expect(transaction.conversationRunEvent.create).not.toHaveBeenCalled();
	});

	it("refuses runtime completion while the run requires tool recovery", async function _deniesRecoveryRequiredCompletion()
	{
		const transaction = _transaction(_run({ state: AgentRunState.RecoveryRequired }));
		const reporter = new PrismaRuntimeTerminalReporter();

		await expect(reporter.reportInTransaction(transaction as never, { runId: "run-1", attempt: 1, eventType: "run.completed" })).resolves.toEqual({ outcome: "denied", reason: "run_not_running" });
		expect(transaction.agentRun.updateMany).not.toHaveBeenCalled();
	});
});
