import { describe, expect, it, vi } from "vitest";

import type { JsonValue } from "@opencrane/util";

import { PrismaRuntimeTranscriptReporter } from "../prisma-runtime-transcript-reporter.js";

/** Build a transaction seam recording the canonical replay events it receives. */
function _Transaction(threadId: string | null = "thread-1", attempt = 1)
{
	return {
		agentRun: { findUnique: vi.fn(async function _Run() { return { attempt, threadId }; }) },
		conversationRunEvent: {
			aggregate: vi.fn(async function _Aggregate() { return { _max: { sequence: 4 } }; }),
			findFirst: vi.fn(async function _Message() { return null; }),
			create: vi.fn(async function _Create() { return {}; }),
		},
	};
}

/** Bind one candidate to the exact authoritative attempt. */
function _Candidate(eventType: string, payload: JsonValue, attempt = 1)
{
	return { protocolVersion: "opencrane.agent-runtime/v1" as const, runtimeInstanceId: "runtime-1", commandId: "command-1", candidateId: "candidate-1", runId: "run-1", attempt, fence: 1, kind: "event" as const, eventType, payload };
}

describe("PrismaRuntimeTranscriptReporter", function _DescribeRuntimeTranscriptReporter()
{
	it("maps runtime text into canonical message start and delta replay events", async function _MapsText()
	{
		const transaction = _Transaction();

		await expect(new PrismaRuntimeTranscriptReporter().reportInTransaction(transaction as never, _Candidate("run.output_text", { text: "hello" }))).resolves.toEqual({ outcome: "reported" });
		expect(transaction.conversationRunEvent.create).toHaveBeenNthCalledWith(1, { data: expect.objectContaining({ sequence: 5, type: "message.started", payload: { messageId: "runtime:run-1:attempt:1" } }) });
		expect(transaction.conversationRunEvent.create).toHaveBeenNthCalledWith(2, { data: expect.objectContaining({ sequence: 6, type: "message.delta", payload: { messageId: "runtime:run-1:attempt:1", delta: "hello" } }) });
	});

	it("preserves a long runtime delta as deterministic replay-sized chunks", async function _SplitsLongText()
	{
		const transaction = _Transaction();
		const text = "x".repeat(1_025);

		await expect(new PrismaRuntimeTranscriptReporter().reportInTransaction(transaction as never, _Candidate("run.output_text", { text }))).resolves.toEqual({ outcome: "reported" });
		expect(transaction.conversationRunEvent.create).toHaveBeenCalledTimes(4);
		expect(transaction.conversationRunEvent.create).toHaveBeenNthCalledWith(2, { data: expect.objectContaining({ sequence: 6, type: "message.delta", payload: { messageId: "runtime:run-1:attempt:1", delta: "x".repeat(512) } }) });
		expect(transaction.conversationRunEvent.create).toHaveBeenNthCalledWith(4, { data: expect.objectContaining({ sequence: 8, type: "message.delta", payload: { messageId: "runtime:run-1:attempt:1", delta: "x" } }) });
	});

	it("rejects a legacy runtime error candidate because it is admitted as a terminal failure", async function _RejectsLegacyError()
	{
		const transaction = _Transaction();

		await expect(new PrismaRuntimeTranscriptReporter().reportInTransaction(transaction as never, _Candidate("run.error", { reason: "model_loop_error", detail: "provider response" }))).resolves.toEqual({ outcome: "denied", reason: "unsupported_runtime_event" });
		expect(transaction.conversationRunEvent.create).not.toHaveBeenCalled();
	});

	it("does not let an earlier attempt suppress the current attempt's message start", async function _KeepsAttemptMessagesSeparate()
	{
		const transaction = _Transaction("thread-1", 2);
		transaction.conversationRunEvent.findFirst.mockResolvedValueOnce(null);

		await new PrismaRuntimeTranscriptReporter().reportInTransaction(transaction as never, _Candidate("run.output_text", { text: "retry" }, 2));
		expect(transaction.conversationRunEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ payload: { path: ["messageId"], equals: "runtime:run-1:attempt:2" } }) }));
	});

	it("denies unrecognised runtime event vocabulary before candidate acceptance", async function _DeniesUnknown()
	{
		const transaction = _Transaction();

		await expect(new PrismaRuntimeTranscriptReporter().reportInTransaction(transaction as never, _Candidate("untrusted.event", {}))).resolves.toEqual({ outcome: "denied", reason: "unsupported_runtime_event" });
		expect(transaction.conversationRunEvent.create).not.toHaveBeenCalled();
	});
});
