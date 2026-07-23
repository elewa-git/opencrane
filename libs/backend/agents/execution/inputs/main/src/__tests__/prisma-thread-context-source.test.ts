import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { describe, expect, it, vi } from "vitest";

import { PrismaThreadContextSource } from "../prisma-thread-context-source.js";

/** Exact interactive admission coordinates used by the transcript source. */
const _COMMAND = { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", threadId: "thread-1", executionSubjectId: "user-1", requestIdempotencyKey: "request-1" };
/** Minimal run authority proving the expected service. */
const _RUN: InitialRunAuthority = { agentServiceId: "service-1", agentRevisionId: "revision-1", agentKind: "personal", effectiveContractDigest: "sha256:contract", promptCompilerVersion: "prompt-v1", trigger: "interactive", delegatedUserId: "user-1", rootRunId: "run-1", parentRunId: null };

/** Build a transaction double whose raw queries first lock the thread then prove participation. */
function _transaction(threadResult: unknown, participantResult: unknown, messages: readonly unknown[] = []): RunAdmissionTransaction
{
	return { prisma: { $queryRaw: vi.fn().mockResolvedValueOnce(threadResult).mockResolvedValueOnce(participantResult), conversationMessage: { findMany: vi.fn().mockResolvedValue(messages) } } as never, admittedAt: "2026-07-23T12:00:00.000Z", admittedAtEpochMs: 0 };
}

describe("PrismaThreadContextSource", function _describeThreadContext()
{
	it("loads completed messages and ordered attachment coordinates through the admission transaction", async function _loadsTranscript()
	{
		const transaction = _transaction([{ id: "thread-1" }], [{ threadId: "thread-1" }], [{ id: "message-1", artifactAttachments: [{ artifactRevisionId: "revision-1", ordinal: 0 }, { artifactRevisionId: "revision-2", ordinal: 1 }] }, { id: "message-2", artifactAttachments: [] }]);

		await expect(new PrismaThreadContextSource().load(_COMMAND, _RUN, transaction)).resolves.toEqual({ outcome: "loaded", value: { messageIds: ["message-1", "message-2"], messageArtifactAttachments: [{ messageId: "message-1", artifactRevisionId: "revision-1", ordinal: 0 }, { messageId: "message-1", artifactRevisionId: "revision-2", ordinal: 1 }] } });
		expect(transaction.prisma.$queryRaw).toHaveBeenCalledTimes(2);
		expect(transaction.prisma.conversationMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { threadId: "thread-1", state: "Completed" } }));
	});

	it("fails closed when the locked thread lacks the execution subject", async function _deniesNonParticipant()
	{
		await expect(new PrismaThreadContextSource().load(_COMMAND, _RUN, _transaction([{ id: "thread-1" }], []))).resolves.toEqual({ outcome: "denied", reason: "thread_unavailable" });
	});
});
