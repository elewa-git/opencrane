import { AgentRunState, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { AG_UI_A2UI_ENVELOPE_VERSION, AgUiA2uiSurfaceStates } from "@opencrane/contracts";

import { PrismaRuntimeEventReporter } from "../prisma-runtime-event-reporter.js";

/** Build one running conversation transaction for reporter tests. */
function _Transaction()
{
	return { agentRun: { findUnique: vi.fn().mockResolvedValue({ id: "run-1", attempt: 2, state: AgentRunState.Running, conversationId: "conversation-1" }) }, conversationRunEvent: { aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 3 } }), create: vi.fn().mockResolvedValue({}) } } as unknown as Prisma.TransactionClient;
}

describe("PrismaRuntimeEventReporter", function _Suite()
{
	it("persists one canonical bounded message delta at the next sequence", async function _MessageDelta()
	{
		const transaction = _Transaction();
		const reporter = new PrismaRuntimeEventReporter();
		await expect(reporter.reportInTransaction(transaction, { runId: "run-1", attempt: 2, eventType: "message.delta", payload: { messageId: "message-1", delta: "hello" } })).resolves.toEqual({ outcome: "reported" });
		expect(transaction.conversationRunEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ conversationId: "conversation-1", runId: "run-1", sequence: 4, type: "message.delta", payload: { messageId: "message-1", delta: "hello" } }) });
	});

	it("fails closed for arbitrary names, secret-shaped fields, and oversized payloads", async function _RejectsUnsafe()
	{
		const transaction = _Transaction();
		const reporter = new PrismaRuntimeEventReporter();
		await expect(reporter.reportInTransaction(transaction, { runId: "run-1", attempt: 2, eventType: "framework.internal", payload: {} })).resolves.toEqual({ outcome: "denied", reason: "invalid_event" });
		await expect(reporter.reportInTransaction(transaction, { runId: "run-1", attempt: 2, eventType: "run.error", payload: { accessToken: "never" } })).resolves.toEqual({ outcome: "denied", reason: "invalid_payload" });
		await expect(reporter.reportInTransaction(transaction, { runId: "run-1", attempt: 2, eventType: "message.delta", payload: { delta: "x".repeat(33_000) } })).resolves.toEqual({ outcome: "denied", reason: "invalid_payload" });
		expect(transaction.conversationRunEvent.create).not.toHaveBeenCalled();
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
