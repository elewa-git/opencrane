import { AgentRunState, AgentRunTerminalReason } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { JsonValue } from "@opencrane/util";

import { PrismaRuntimeTerminalReporter } from "../prisma-runtime-terminal-reporter";
import type { RuntimeTerminalReportCommand, RuntimeTerminalEventType } from "../runtime-terminal-reporter.types";

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

/** Builds a fully fenced terminal command from one accepted runtime command. */
function _command(eventType: RuntimeTerminalEventType, sourceIsStartAttempt = true, reason = "executor_failed"): RuntimeTerminalReportCommand
{
	const payload: JsonValue = eventType === "run.completed" ? {} : { reason };
	return { runId: "run-1", attempt: 1, sourceIsStartAttempt, eventType, payload };
}

describe("PrismaRuntimeTerminalReporter", function _describeReporter()
{
	it("commits a fenced runtime success and its canonical stream event together", async function _reportsCompletion()
	{
		const transaction = _transaction(_run());
		const reporter = new PrismaRuntimeTerminalReporter();

		await expect(reporter.reportInTransaction(transaction as never, _command("run.completed"))).resolves.toEqual({ outcome: "reported" });
		expect(transaction.agentRun.updateMany).toHaveBeenCalledWith({ where: { id: "run-1", attempt: 1, state: AgentRunState.Running }, data: expect.objectContaining({ state: AgentRunState.Completed, terminalReason: AgentRunTerminalReason.Success }) });
		expect(transaction.conversationRunEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ conversationId: "conversation-1", runId: "run-1", sequence: 5, type: "run.completed", payload: { terminalReason: "success" } }) });
	});

	it("commits runtime failure when candidate delivery failed before any durable tool work existed", async function _reportsPreAdmissionFailure()
	{
		const transaction = _transaction(_run());
		const reporter = new PrismaRuntimeTerminalReporter();

		await expect(reporter.reportInTransaction(transaction as never, _command("run.failed"))).resolves.toEqual({ outcome: "reported" });
		expect(transaction.agentRun.updateMany).toHaveBeenCalledWith({ where: { id: "run-1", attempt: 1, state: AgentRunState.Running }, data: expect.objectContaining({ state: AgentRunState.Failed, terminalReason: AgentRunTerminalReason.RuntimeFailure }) });
		expect(transaction.conversationRunEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ conversationId: "conversation-1", runId: "run-1", sequence: 5, type: "run.failed", payload: { terminalReason: "runtime_failure" } }) });
	});

	it("refuses success while an external action or saved result is unresolved", async function _deniesPrematureSuccess()
	{
		const transaction = _transaction(_run(), 1, 1, 1);
		const reporter = new PrismaRuntimeTerminalReporter();

		await expect(reporter.reportInTransaction(transaction as never, _command("run.completed"))).resolves.toEqual({ outcome: "denied", reason: "tool_results_pending" });
		expect(transaction.agentRun.updateMany).not.toHaveBeenCalled();
	});

	it("refuses runtime failure when a committed action has not reached the worker", async function _deniesFailureBeforeWorker()
	{
		const transaction = _transaction(_run(), 1, 1, 0);
		const reporter = new PrismaRuntimeTerminalReporter();

		await expect(reporter.reportInTransaction(transaction as never, _command("run.failed"))).resolves.toEqual({ outcome: "denied", reason: "tool_results_pending" });
		expect(transaction.agentRun.updateMany).not.toHaveBeenCalled();
		expect(transaction.conversationRunEvent.create).not.toHaveBeenCalled();
	});

	it("refuses runtime failure while a provider claim remains unresolved", async function _deniesFailureDuringProviderClaim()
	{
		const transaction = _transaction(_run(), 1, 1, 0);
		const reporter = new PrismaRuntimeTerminalReporter();

		await expect(reporter.reportInTransaction(transaction as never, _command("run.failed"))).resolves.toEqual({ outcome: "denied", reason: "tool_results_pending" });
		expect(transaction.agentRun.updateMany).not.toHaveBeenCalled();
		expect(transaction.conversationRunEvent.create).not.toHaveBeenCalled();
	});

	it("refuses runtime failure after provider settlement while its saved result is pending", async function _deniesFailureWithPendingResult()
	{
		const transaction = _transaction(_run(), 1, 0, 1);
		const reporter = new PrismaRuntimeTerminalReporter();

		await expect(reporter.reportInTransaction(transaction as never, _command("run.failed"))).resolves.toEqual({ outcome: "denied", reason: "tool_results_pending" });
		expect(transaction.agentRun.updateMany).not.toHaveBeenCalled();
		expect(transaction.conversationRunEvent.create).not.toHaveBeenCalled();
	});

	it("refuses a report after cancellation or another terminal writer won", async function _deniesStaleReport()
	{
		const transaction = _transaction(_run({ state: AgentRunState.Cancelling }));
		const reporter = new PrismaRuntimeTerminalReporter();

		await expect(reporter.reportInTransaction(transaction as never, _command("run.failed"))).resolves.toEqual({ outcome: "denied", reason: "run_not_running" });
		expect(transaction.agentRun.updateMany).not.toHaveBeenCalled();
		expect(transaction.conversationRunEvent.create).not.toHaveBeenCalled();
	});

	it("refuses runtime completion while the run requires tool recovery", async function _deniesRecoveryRequiredCompletion()
	{
		const transaction = _transaction(_run({ state: AgentRunState.RecoveryRequired }));
		const reporter = new PrismaRuntimeTerminalReporter();

		await expect(reporter.reportInTransaction(transaction as never, _command("run.completed"))).resolves.toEqual({ outcome: "denied", reason: "run_not_running" });
		expect(transaction.agentRun.updateMany).not.toHaveBeenCalled();
	});

	it("fails an assigned run only for a coordinate mismatch bound to its accepted start command", async function _FailsExactPreStartMismatch()
	{
		const transaction = _transaction(_run({ state: AgentRunState.Assigned }));
		const reporter = new PrismaRuntimeTerminalReporter();

		await expect(reporter.reportInTransaction(transaction as never, _command("run.failed", true, "compiled_input_coordinate_mismatch"))).resolves.toEqual({ outcome: "reported" });
		expect(transaction.agentRun.updateMany).toHaveBeenCalledWith({ where: { id: "run-1", attempt: 1, state: AgentRunState.Assigned }, data: expect.objectContaining({ state: AgentRunState.Failed, terminalReason: AgentRunTerminalReason.RuntimeFailure }) });
		expect(transaction.conversationRunEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "run.failed", payload: { terminalReason: "runtime_failure" } }) });
	});

	it("does not let a resume command terminalise a run that never started", async function _RejectsResumeMismatchBeforeStart()
	{
		const transaction = _transaction(_run({ state: AgentRunState.Assigned }));
		const reporter = new PrismaRuntimeTerminalReporter();

		await expect(reporter.reportInTransaction(transaction as never, _command("run.failed", false, "compiled_input_coordinate_mismatch"))).resolves.toEqual({ outcome: "denied", reason: "run_not_running" });
		expect(transaction.agentRun.updateMany).not.toHaveBeenCalled();
	});

	it("does not let a start command use another failure reason before run.started", async function _RejectsOtherPreStartFailure()
	{
		const transaction = _transaction(_run({ state: AgentRunState.Assigned }));
		const reporter = new PrismaRuntimeTerminalReporter();

		await expect(reporter.reportInTransaction(transaction as never, _command("run.failed", true, "executor_failed"))).resolves.toEqual({ outcome: "denied", reason: "run_not_running" });
		expect(transaction.agentRun.updateMany).not.toHaveBeenCalled();
	});
});
