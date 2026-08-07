import { ConversationMessageState, ConversationThreadState } from "@prisma/client";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { describe, expect, it, vi } from "vitest";
import { AgentServiceKinds } from "@opencrane/models/agents";

import { PrismaThreadContextSource } from "../prisma-thread-context-source.js";

/** Creates personal run authority bound to the target conversation service. */
function _Run(): InitialRunAuthority
{
	return { agentServiceId: "service-1", agentRevisionId: "revision-1", agentKind: AgentServiceKinds.Personal, effectiveContractDigest: "sha256:contract", promptCompilerVersion: "v1", trigger: "interactive", delegatedUserId: "user-1", rootRunId: "run-1", parentRunId: null };
}

/** Creates the command coordinates for an authenticated conversation participant. */
function _Command(threadId: string | null = "thread-1")
{
	return { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", threadId, identityKind: "user", trigger: "interactive", executionSubjectId: "user-1", requestIdempotencyKey: "request-1" } as never;
}

/** Creates the narrow transaction facade used by the transcript authority. */
function _Transaction(thread: unknown, messages: readonly unknown[] = []): RunAdmissionTransaction
{
	return { prisma: { conversationThread: { findFirst: vi.fn().mockResolvedValue(thread) }, conversationMessage: { findMany: vi.fn().mockResolvedValue(messages) } } as never, admittedAt: "2026-07-26T00:00:00.000Z", admittedAtEpochMs: Date.parse("2026-07-26T00:00:00.000Z") };
}

describe("PrismaThreadContextSource", function _DescribePrismaThreadContextSource()
{
	it("freezes only completed messages from the active same-service participant thread", async function _LoadsThread()
	{
		const transaction = _Transaction({ id: "thread-1" }, [{ id: "message-1" }, { id: "message-2" }]);
		await expect(new PrismaThreadContextSource().load(_Command(), _Run(), transaction)).resolves.toEqual({ outcome: "loaded", value: { messageIds: ["message-1", "message-2"] } });
		expect(transaction.prisma.conversationThread.findFirst).toHaveBeenCalledWith({ where: { id: "thread-1", siloId: "silo-1", agentServiceId: "service-1", state: ConversationThreadState.Active, participants: { some: { userId: "user-1" } } }, select: { id: true } });
		expect(transaction.prisma.conversationMessage.findMany).toHaveBeenCalledWith({ where: { threadId: "thread-1", state: ConversationMessageState.Completed }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
	});

	it("denies an absent or unauthorized thread and skips reads for non-conversational work", async function _ScopesThread()
	{
		await expect(new PrismaThreadContextSource().load(_Command(), _Run(), _Transaction(null))).resolves.toEqual({ outcome: "denied", reason: "thread_unavailable" });
		const transaction = _Transaction({ id: "thread-1" });
		await expect(new PrismaThreadContextSource().load(_Command(null), _Run(), transaction)).resolves.toEqual({ outcome: "loaded", value: { messageIds: [] } });
		expect(transaction.prisma.conversationThread.findFirst).not.toHaveBeenCalled();
	});
});
