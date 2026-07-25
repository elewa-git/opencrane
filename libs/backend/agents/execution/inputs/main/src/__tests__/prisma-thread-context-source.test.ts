import { ConversationMessageState, ConversationThreadState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaThreadContextSource } from "../prisma-thread-context-source.js";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

/** Create one personal run bound to the target conversation service. */
function _Run(overrides: Partial<InitialRunAuthority> = {}): InitialRunAuthority
{
	return { agentServiceId: "service-1", agentRevisionId: "revision-1", agentKind: "personal", effectiveContractDigest: "sha256:contract", promptCompilerVersion: "v1", trigger: "interactive", delegatedUserId: "user-1", rootRunId: "run-1", parentRunId: null, ...overrides };
}

/** Create target admission coordinates for one authenticated conversation participant. */
function _Command(overrides: Record<string, unknown> = {})
{
	return { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", threadId: "thread-1", executionSubjectId: "user-1", requestIdempotencyKey: "request-1", ...overrides } as never;
}

/** Create the transaction façade used by the transcript authority. */
function _Transaction(thread: unknown, messages: readonly unknown[] = []): RunAdmissionTransaction
{
	return { prisma: { conversationThread: { findFirst: vi.fn().mockResolvedValue(thread) }, conversationMessage: { findMany: vi.fn().mockResolvedValue(messages) } } as never, admittedAt: "2026-07-25T00:00:00.000Z", admittedAtEpochMs: Date.parse("2026-07-25T00:00:00.000Z") };
}

describe("PrismaThreadContextSource", function _DescribeThreadContextSource()
{
	it("loads completed message IDs in stable transcript order from the exact active participant thread", async function _LoadsThread()
	{
		const transaction = _Transaction({ id: "thread-1" }, [{ id: "message-1" }, { id: "message-2" }]);
		await expect(new PrismaThreadContextSource().load(_Command(), _Run(), transaction)).resolves.toEqual({ outcome: "loaded", value: { messageIds: ["message-1", "message-2"] } });
		expect(transaction.prisma.conversationThread.findFirst).toHaveBeenCalledWith({ where: { id: "thread-1", siloId: "silo-1", agentServiceId: "service-1", state: ConversationThreadState.Active, participants: { some: { userId: "user-1" } } }, select: { id: true } });
		expect(transaction.prisma.conversationMessage.findMany).toHaveBeenCalledWith({ where: { threadId: "thread-1", state: ConversationMessageState.Completed }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
	});

	it("rejects a missing, archived, cross-service, or non-participant thread through the scoped query", async function _RejectsUnboundThread()
	{
		const transaction = _Transaction(null);
		await expect(new PrismaThreadContextSource().load(_Command(), _Run(), transaction)).resolves.toEqual({ outcome: "denied", reason: "thread_unavailable" });
		expect(transaction.prisma.conversationMessage.findMany).not.toHaveBeenCalled();
	});

	it("keeps non-conversational runs free of transcript inputs without querying messages", async function _KeepsNonConversationalInputEmpty()
	{
		const transaction = _Transaction({ id: "thread-1" });
		await expect(new PrismaThreadContextSource().load(_Command({ threadId: null }), _Run(), transaction)).resolves.toEqual({ outcome: "loaded", value: { messageIds: [] } });
		expect(transaction.prisma.conversationThread.findFirst).not.toHaveBeenCalled();
	});
});
