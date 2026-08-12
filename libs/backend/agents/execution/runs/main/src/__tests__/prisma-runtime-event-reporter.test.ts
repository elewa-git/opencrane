import { AgentRunState, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { AG_UI_A2UI_ENVELOPE_VERSION, AgUiA2uiSurfaceStates } from "@opencrane/contracts";

import { PrismaRuntimeEventReporter } from "../prisma-runtime-event-reporter.js";

/** Build one running conversation transaction for reporter tests. */
function _Transaction()
{
	return { agentRun: { findUnique: vi.fn().mockResolvedValue({ id: "run-1", attempt: 2, state: AgentRunState.Running, conversationId: "conversation-1" }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, conversationRunEvent: { aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 3 } }), create: vi.fn().mockResolvedValue({}) } } as unknown as Prisma.TransactionClient;
}

describe("PrismaRuntimeEventReporter", function _Suite()
{
	it("persists one canonical bounded message delta at the next sequence", async function _MessageDelta()
	{
		const transaction = _Transaction();
		const reporter = new PrismaRuntimeEventReporter();
		await expect(reporter.reportInTransaction(transaction, { runId: "run-1", attempt: 2, eventType: "message.delta", payload: { messageId: "message-1", delta: "hello" } })).resolves.toEqual({ outcome: "reported" });
		expect(transaction.conversationRunEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ conversationId: "conversation-1", runId: "run-1", sequence: 4, type: "message.delta", messageId: "message-1", payload: { messageId: "message-1", delta: "hello" } }) });
	});

	it("atomically starts only the exact assigned attempt before appending run.started", async function _StartsAssignedAttempt()
	{
		const transaction = _Transaction();
		vi.mocked(transaction.agentRun.findUnique).mockResolvedValue({ id: "run-1", attempt: 2, state: AgentRunState.Assigned, conversationId: "conversation-1" } as never);
		const reporter = new PrismaRuntimeEventReporter();

		await expect(reporter.reportInTransaction(transaction, { runId: "run-1", attempt: 2, eventType: "run.started", payload: { promptCompilerVersion: "v1" } })).resolves.toEqual({ outcome: "reported" });
		expect(transaction.agentRun.updateMany).toHaveBeenCalledWith({ where: { id: "run-1", attempt: 2, state: AgentRunState.Assigned }, data: { state: AgentRunState.Running, startedAt: expect.any(Date) } });
		expect(vi.mocked(transaction.agentRun.updateMany).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(transaction.conversationRunEvent.create).mock.invocationCallOrder[0]!);
		expect(transaction.conversationRunEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ runId: "run-1", sequence: 4, type: "run.started", payload: { promptCompilerVersion: "v1" } }) });
	});

	it("starts a managed run without inventing a conversation event", async function _StartsConversationlessRun()
	{
		const transaction = _Transaction();
		vi.mocked(transaction.agentRun.findUnique).mockResolvedValue({ id: "run-1", attempt: 2, state: AgentRunState.Assigned, conversationId: null } as never);
		const reporter = new PrismaRuntimeEventReporter();

		await expect(reporter.reportInTransaction(transaction, { runId: "run-1", attempt: 2, eventType: "run.started", payload: { promptCompilerVersion: "v1" } })).resolves.toEqual({ outcome: "reported" });
		expect(transaction.agentRun.updateMany).toHaveBeenCalledWith({ where: { id: "run-1", attempt: 2, state: AgentRunState.Assigned }, data: { state: AgentRunState.Running, startedAt: expect.any(Date) } });
		expect(transaction.conversationRunEvent.create).not.toHaveBeenCalled();
	});

	it("persists run.resumed only with the runtime's exact input generation", async function _ResumesRunningAttempt()
	{
		const transaction = _Transaction();
		const reporter = new PrismaRuntimeEventReporter();

		await expect(reporter.reportInTransaction(transaction, { runId: "run-1", attempt: 2, eventType: "run.resumed", payload: { inputGeneration: 3 } })).resolves.toEqual({ outcome: "reported" });
		expect(transaction.conversationRunEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ runId: "run-1", sequence: 4, type: "run.resumed", payload: { inputGeneration: 3 } }) });
	});

	it("denies duplicate starts and resumes outside the running lifecycle", async function _RejectsInvalidLifecycleEvent()
	{
		const transaction = _Transaction();
		vi.mocked(transaction.agentRun.updateMany).mockResolvedValue({ count: 0 });
		const reporter = new PrismaRuntimeEventReporter();

		await expect(reporter.reportInTransaction(transaction, { runId: "run-1", attempt: 2, eventType: "run.started", payload: { promptCompilerVersion: "v1" } })).resolves.toEqual({ outcome: "denied", reason: "run_not_assigned" });
		vi.mocked(transaction.agentRun.findUnique).mockResolvedValue({ id: "run-1", attempt: 2, state: AgentRunState.WaitingForApproval, conversationId: "conversation-1" } as never);
		await expect(reporter.reportInTransaction(transaction, { runId: "run-1", attempt: 2, eventType: "run.resumed", payload: { inputGeneration: 1 } })).resolves.toEqual({ outcome: "denied", reason: "run_not_running" });
		expect(transaction.conversationRunEvent.create).not.toHaveBeenCalled();
	});

	it("fails closed for arbitrary names, secret-shaped fields, and oversized payloads", async function _RejectsUnsafe()
	{
		const transaction = _Transaction();
		const reporter = new PrismaRuntimeEventReporter();
		await expect(reporter.reportInTransaction(transaction, { runId: "run-1", attempt: 2, eventType: "framework.internal", payload: {} })).resolves.toEqual({ outcome: "denied", reason: "invalid_event" });
		await expect(reporter.reportInTransaction(transaction, { runId: "run-1", attempt: 2, eventType: "run.started", payload: {} })).resolves.toEqual({ outcome: "denied", reason: "invalid_payload" });
		await expect(reporter.reportInTransaction(transaction, { runId: "run-1", attempt: 2, eventType: "run.resumed", payload: { inputGeneration: -1 } })).resolves.toEqual({ outcome: "denied", reason: "invalid_payload" });
		await expect(reporter.reportInTransaction(transaction, { runId: "run-1", attempt: 2, eventType: "run.error", payload: { accessToken: "never" } })).resolves.toEqual({ outcome: "denied", reason: "invalid_payload" });
		await expect(reporter.reportInTransaction(transaction, { runId: "run-1", attempt: 2, eventType: "run.error", payload: { reason: "model_loop_error", detail: "Bearer never" } })).resolves.toEqual({ outcome: "denied", reason: "invalid_payload" });
		await expect(reporter.reportInTransaction(transaction, { runId: "run-1", attempt: 2, eventType: "message.delta", payload: { messageId: "message-1", delta: "x".repeat(33_000) } })).resolves.toEqual({ outcome: "denied", reason: "invalid_payload" });
		expect(transaction.conversationRunEvent.create).not.toHaveBeenCalled();
	});

	it("rejects server-owned tool lifecycle events from the runtime", async function _RejectsToolLifecycle()
	{
		const transaction = _Transaction();
		const reporter = new PrismaRuntimeEventReporter();
		for (const eventType of ["tool.started", "tool.completed", "tool.failed"])
		{
			await expect(reporter.reportInTransaction(transaction, { runId: "run-1", attempt: 2, eventType, payload: {} })).resolves.toEqual({ outcome: "denied", reason: "invalid_event" });
		}
		expect(transaction.conversationRunEvent.create).not.toHaveBeenCalled();
	});

	it("accepts the current saved-result validation errors without accepting details", async function _AcceptsResultErrors()
	{
		const transaction = _Transaction();
		const reporter = new PrismaRuntimeEventReporter();
		await expect(reporter.reportInTransaction(transaction, { runId: "run-1", attempt: 2, eventType: "run.error", payload: { reason: "invalid_tool_result" } })).resolves.toEqual({ outcome: "reported" });
		await expect(reporter.reportInTransaction(transaction, { runId: "run-1", attempt: 2, eventType: "run.error", payload: { reason: "unknown_tool_result" } })).resolves.toEqual({ outcome: "reported" });
	});

	it("accepts only a versioned A2UI envelope bound to the durable run and conversation", async function _A2uiCoordinates()
	{
		const transaction = _Transaction();
		const reporter = new PrismaRuntimeEventReporter();
		const a2ui = { version: AG_UI_A2UI_ENVELOPE_VERSION, conversationId: "conversation-1", runId: "run-1", messageId: "message-1", surfaceId: "surface-1", sequence: 1, state: AgUiA2uiSurfaceStates.Streaming, operations: [{ beginRendering: { surfaceId: "surface-1", root: "root-1" } }] };
		await expect(reporter.reportInTransaction(transaction, { runId: "run-1", attempt: 2, eventType: "a2ui.rendering.begun", payload: { a2ui } })).resolves.toEqual({ outcome: "reported" });
		await expect(reporter.reportInTransaction(transaction, { runId: "run-1", attempt: 2, eventType: "a2ui.surface.updated", payload: { a2ui: { ...a2ui, runId: "run-other" } } })).resolves.toEqual({ outcome: "denied", reason: "invalid_payload" });
	});
});
