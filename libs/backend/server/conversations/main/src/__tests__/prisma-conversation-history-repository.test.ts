import { describe, expect, it, vi } from "vitest";

import { PrismaConversationHistoryRepository } from "../db/prisma-conversation-history-repository";
import { PrismaConversationProductAuthorizationRepository } from "../db/conversation-product-authorization";
import { ProductAuthorizationActions } from "@opencrane/models/authorization";

const _CALLER = { principalId: "principal-1", subjectId: "user-1", siloId: "silo-1" };
const _ENCRYPTED = { keyId: "key-1", nonce: new Uint8Array(12), authTag: new Uint8Array(16), ciphertext: new Uint8Array([1]), ciphertextDigest: `sha256:${"a".repeat(64)}` };

function _Row(id: string)
{
	return { id, siloId: "silo-1", conversationId: "conversation-1", authorSubject: "user-1", idempotencyKey: "retry-1", keyId: "key-1", nonce: Buffer.alloc(12), authTag: Buffer.alloc(16), ciphertext: Buffer.from([1]), ciphertextDigest: `sha256:${"a".repeat(64)}` };
}

function _Harness(existing: ReturnType<typeof _Row> | null)
{
	const transaction = {
		conversationPrivatePayload: { findUnique: vi.fn().mockResolvedValue(existing), create: vi.fn().mockResolvedValue(_Row("payload-1")) },
		conversation: { update: vi.fn().mockResolvedValue({ id: "conversation-1" }) },
	};
	return { transaction, repository: new PrismaConversationHistoryRepository(transaction as never) };
}

describe("PrismaConversationHistoryRepository.createOrReadPayload", function _CreateOrReadPayloadSuite()
{
	it("loads exactly the current participant join bound after central Conversation Read authorization", async function ()
	{
		const canAccess = vi.spyOn(PrismaConversationProductAuthorizationRepository.prototype, "canAccess").mockResolvedValue(true);
		try
		{
			const transaction = { conversationChildRequest: { findUnique: vi.fn().mockResolvedValue(null) }, orgMembership: { findUnique: vi.fn().mockResolvedValue({ status: "Active", displayName: "Participant" }) }, conversation: { findFirst: vi.fn().mockResolvedValue({ mode: "Direct", computerId: null, computerAgentIdentityId: null, computerProfileRevisionId: null, participants: [{ visibleFromPosition: 5n }] }) } };
			const repository = new PrismaConversationHistoryRepository(transaction as never);
			expect((await repository.authorizeRead(_CALLER, "conversation-1"))?.visibleFromPosition).toBe(5n);
			expect(canAccess).toHaveBeenCalledWith(_CALLER, "conversation-1", ProductAuthorizationActions.Read);
			expect(transaction.conversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "conversation-1", siloId: "silo-1", participants: { some: { userId: "user-1", accessEndedPosition: null } } }, select: expect.objectContaining({ participants: { where: { userId: "user-1", accessEndedPosition: null }, select: { visibleFromPosition: true } } }) }));
			canAccess.mockResolvedValue(false);
			expect(await repository.authorizeRead(_CALLER, "conversation-1")).toBeNull();
		}
		finally { canAccess.mockRestore(); }
	});

	it("moves the conversation to the top of every list in the same transaction that stores a new payload", async function _BumpsOnCreate()
	{
		const harness = _Harness(null);
		const result = await harness.repository.createOrReadPayload(_CALLER, "conversation-1", "retry-1", "payload-1", _ENCRYPTED);
		expect(result.created).toBe(true);
		expect(harness.transaction.conversationPrivatePayload.create).toHaveBeenCalledTimes(1);
		expect(harness.transaction.conversation.update).toHaveBeenCalledWith({ where: { id_siloId: { id: "conversation-1", siloId: "silo-1" } }, data: { updatedAt: expect.any(Date) }, select: { id: true } });
		expect(harness.transaction.conversation.update.mock.invocationCallOrder[0]).toBeGreaterThan(harness.transaction.conversationPrivatePayload.create.mock.invocationCallOrder[0]!);
	});

	it("leaves the conversation ordering alone when a retry finds the payload already stored", async function _NoBumpOnRetry()
	{
		const harness = _Harness(_Row("payload-existing"));
		const result = await harness.repository.createOrReadPayload(_CALLER, "conversation-1", "retry-1", "payload-1", _ENCRYPTED);
		expect(result).toMatchObject({ created: false, payload: { coordinates: { payloadRef: "payload-existing" } } });
		expect(harness.transaction.conversationPrivatePayload.create).not.toHaveBeenCalled();
		expect(harness.transaction.conversation.update).not.toHaveBeenCalled();
	});
	it("denies an otherwise authorized child when its current parent grant ends", async function ()
	{
		const authorization = vi.spyOn(PrismaConversationProductAuthorizationRepository.prototype, "canAccess").mockImplementation(async (_caller, conversationId) => conversationId !== "parent");
		try
		{
			const transaction = { orgMembership: { findUnique: vi.fn().mockResolvedValue({ status: "Active", displayName: "Human" }) }, conversationChildRequest: { findUnique: vi.fn().mockResolvedValue({ siloId: "silo-1", state: "Ready", parentConversationId: "parent", parentMessagePosition: 5n, participantSubjectIds: ["user-1"] }) }, conversation: { findFirst: vi.fn().mockResolvedValue({ id: "conversation-1", mode: "AgentSession", computerId: "computer", computerAgentIdentityId: "identity", computerProfileRevisionId: "profile", participants: [{ visibleFromPosition: 1n }] }) } };
			const repository = new PrismaConversationHistoryRepository(transaction as never);
			expect(await repository.authorizeRead(_CALLER, "conversation-1")).toBeNull();
			expect(await repository.authorizeWrite(_CALLER, "conversation-1")).toBeNull();
			expect(transaction.conversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "parent", participants: { some: { userId: "user-1", accessEndedPosition: null, visibleFromPosition: { lte: 5n } } } }) }));
		}
		finally { authorization.mockRestore(); }
	});

});
