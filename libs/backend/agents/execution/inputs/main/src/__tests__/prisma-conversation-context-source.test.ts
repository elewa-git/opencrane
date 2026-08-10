import { ConversationMessageState, ConversationLifecycle, ConversationMode } from "@prisma/client";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { describe, expect, it, vi } from "vitest";
import { AgentServiceKinds } from "@opencrane/models/agents";

import { PrismaConversationContextRepository } from "../prisma-conversation-context-repository.js";
import { TransactionBoundConversationContextSource } from "../prisma-conversation-context-source.js";

/** Creates personal run authority bound to the target conversation service. */
function _Run(): InitialRunAuthority
{
	return { agentServiceId: "service-1", agentRevisionId: "revision-1", agentKind: AgentServiceKinds.Personal, effectiveContractDigest: "sha256:contract", promptCompilerVersion: "v1", trigger: "interactive", delegatedUserId: "user-1", rootRunId: "run-1", parentRunId: null };
}

/** Creates the command coordinates for an authenticated conversation participant. */
function _Command(conversationId: string | null = "conversation-1")
{
	return { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", conversationId, identityKind: "user", trigger: "interactive", executionSubjectId: "user-1", requestIdempotencyKey: "request-1", inputMessageId: "message-current", inputMessageBlocks: [{ id: "block-1", kind: "text", value: "Hello" }] } as never;
}

/** Creates the narrow transaction facade used by the transcript authority. */
function _Transaction(conversation: unknown, entries: readonly unknown[] = []): RunAdmissionTransaction
{
	return { prisma: { conversation: { findFirst: vi.fn().mockResolvedValue(conversation) }, conversationTimelineEntry: { findMany: vi.fn().mockResolvedValue(entries) } } as never, admittedAt: "2026-07-26T00:00:00.000Z", admittedAtEpochMs: Date.parse("2026-07-26T00:00:00.000Z") };
}

describe("TransactionBoundConversationContextSource", function _DescribeTransactionBoundConversationContextSource()
{
	it("freezes only completed messages from the active same-service participant conversation", async function _LoadsConversation()
	{
		const transaction = _Transaction({ id: "conversation-1" }, [{ messageId: "message-1" }, { messageId: "message-2" }]);
		await expect(_Source().load(_Command(), _Run(), transaction)).resolves.toEqual({ outcome: "loaded", value: { messageIds: ["message-1", "message-2", "message-current"], pendingUserMessage: { id: "message-current", blocks: [{ id: "block-1", kind: "text", value: "Hello" }] } } });
		expect(transaction.prisma.conversation.findFirst).toHaveBeenCalledWith({ where: { id: "conversation-1", siloId: "silo-1", agentServiceId: "service-1", mode: ConversationMode.AgentSession, lifecycle: ConversationLifecycle.Open, participants: { some: { userId: "user-1", accessEndedPosition: null } } }, select: { id: true } });
		expect(transaction.prisma.conversationTimelineEntry.findMany).toHaveBeenCalledWith({ where: { conversationId: "conversation-1", message: { is: { state: ConversationMessageState.Completed } } }, orderBy: { position: "asc" }, select: { messageId: true } });
	});

	it("denies an absent or unauthorized conversation and skips reads for non-conversational work", async function _ScopesConversation()
	{
		await expect(_Source().load(_Command(), _Run(), _Transaction(null))).resolves.toEqual({ outcome: "denied", reason: "conversation_unavailable" });
		const transaction = _Transaction({ id: "conversation-1" });
		await expect(_Source().load(_Command(null), _Run(), transaction)).resolves.toEqual({ outcome: "loaded", value: { messageIds: [], pendingUserMessage: null } });
		expect(transaction.prisma.conversation.findFirst).not.toHaveBeenCalled();
	});
});

/** Creates the source with its exact transaction-bound Prisma repository. */
function _Source(): TransactionBoundConversationContextSource
{
	return new TransactionBoundConversationContextSource(transaction => new PrismaConversationContextRepository(transaction.prisma));
}
