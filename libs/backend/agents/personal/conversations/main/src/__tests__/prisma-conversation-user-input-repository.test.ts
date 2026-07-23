import { Prisma, type PrismaClient } from "@prisma/client";
import type { Logger } from "@opencrane/observability";
import { describe, expect, it, vi } from "vitest";

import { PrismaConversationUserInputRepository } from "../prisma-conversation-user-input-repository.js";

/** Stable coordinates for one ordinary personal conversation submission. */
const _COMMAND = { messageId: "message-1", siloId: "silo-1", threadId: "thread-1", userId: "user-1", text: "Please inspect this image", artifactRevisionIds: ["revision-1", "revision-2"] } as const;

/** Build a silent structured logger so persistence-failure assertions do not write test output. */
function _logger(): Logger
{
	return { error: vi.fn() } as unknown as Logger;
}

/** Build a canonical published revision row that passes the ownership and lifecycle fence. */
function _revision(id: string): { readonly id: string; readonly state: string; readonly artifactState: string; readonly siloId: string; readonly ownerPrincipalId: string }
{
	return { id, state: "published", artifactState: "active", siloId: _COMMAND.siloId, ownerPrincipalId: _COMMAND.userId };
}

/** Build a Prisma double that runs the admission callback against the supplied transaction double. */
function _prisma(rawResults: readonly unknown[], transactionOverrides: Record<string, unknown> = {}, rootOverrides: Record<string, unknown> = {}): PrismaClient
{
	const transaction = {
		$queryRaw: vi.fn(),
		conversationMessage: {
			create: vi.fn().mockResolvedValue({ id: _COMMAND.messageId }),
			update: vi.fn().mockResolvedValue({ id: _COMMAND.messageId }),
		},
		...transactionOverrides,
	};
	for (const result of rawResults)
	{
		transaction.$queryRaw.mockResolvedValueOnce(result);
	}
	return {
		$transaction: vi.fn(async function _runAdmission(callback): Promise<unknown>
		{
			return callback(transaction);
		}),
		conversationMessage: { ...transaction.conversationMessage, findUnique: vi.fn() },
		...rootOverrides,
	} as unknown as PrismaClient;
}

describe("PrismaConversationUserInputRepository", function _describePrismaConversationUserInputRepository()
{
	it("does not create a message when the active thread cannot be locked", async function _deniesUnavailableThread()
	{
		const prisma = _prisma([[]]);
		const result = await new PrismaConversationUserInputRepository(prisma, _logger()).submitAtomically(_COMMAND);

		expect(result).toEqual({ status: "thread_unavailable" });
		expect(prisma.conversationMessage.create).not.toHaveBeenCalled();
	});

	it("fails closed when any requested revision is unavailable", async function _deniesUnavailableArtifact()
	{
		const prisma = _prisma([[{ id: _COMMAND.threadId }], [{ threadId: _COMMAND.threadId }], [_revision("revision-1")]]);
		const result = await new PrismaConversationUserInputRepository(prisma, _logger()).submitAtomically(_COMMAND);

		expect(result).toEqual({ status: "artifact_unavailable" });
		expect(prisma.conversationMessage.create).not.toHaveBeenCalled();
	});

	it("creates all ordered attachments while pending before completing the message", async function _createsCompleteAtomicInput()
	{
		const prisma = _prisma([[{ id: _COMMAND.threadId }], [{ threadId: _COMMAND.threadId }], [_revision("revision-1"), _revision("revision-2")]]);
		const result = await new PrismaConversationUserInputRepository(prisma, _logger()).submitAtomically(_COMMAND);

		expect(result).toEqual({ status: "submitted" });
		expect(prisma.conversationMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: "Pending", blocks: [{ id: "text-1", type: "text", value: _COMMAND.text }], artifactAttachments: { create: [{ artifactRevisionId: "revision-1", ordinal: 0, attachedBy: _COMMAND.userId }, { artifactRevisionId: "revision-2", ordinal: 1, attachedBy: _COMMAND.userId }] } }) }));
		expect(prisma.conversationMessage.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: _COMMAND.messageId }, data: expect.objectContaining({ state: "Completed" }) }));
		const createOrder = (prisma.conversationMessage.create as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
		const completeOrder = (prisma.conversationMessage.update as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
		expect(createOrder).toBeLessThan(completeOrder);
	});

	it("recovers only an exact duplicate after a lost successful response", async function _recoversExactDuplicate()
	{
		const uniqueError = new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" });
		const prisma = _prisma([], {}, { $transaction: vi.fn().mockRejectedValue(uniqueError), conversationMessage: { findUnique: vi.fn().mockResolvedValue({ id: _COMMAND.messageId, threadId: _COMMAND.threadId, userId: _COMMAND.userId, role: "User", source: "user_input", state: "Completed", blocks: [{ id: "text-1", type: "text", value: _COMMAND.text }], artifactAttachments: [{ artifactRevisionId: "revision-1", ordinal: 0, attachedBy: _COMMAND.userId }, { artifactRevisionId: "revision-2", ordinal: 1, attachedBy: _COMMAND.userId }] }) } });

		await expect(new PrismaConversationUserInputRepository(prisma, _logger()).submitAtomically(_COMMAND)).resolves.toEqual({ status: "submitted" });
	});

	it("does not mistake a different persisted input for a retry", async function _deniesDifferentDuplicate()
	{
		const uniqueError = new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" });
		const prisma = _prisma([], {}, { $transaction: vi.fn().mockRejectedValue(uniqueError), conversationMessage: { findUnique: vi.fn().mockResolvedValue({ id: _COMMAND.messageId, threadId: _COMMAND.threadId, userId: _COMMAND.userId, role: "User", source: "user_input", state: "Completed", blocks: [], artifactAttachments: [] }) } });

		await expect(new PrismaConversationUserInputRepository(prisma, _logger()).submitAtomically(_COMMAND)).resolves.toEqual({ status: "conflict" });
	});
});
