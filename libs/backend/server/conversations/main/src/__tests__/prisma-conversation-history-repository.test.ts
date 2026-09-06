import { describe, expect, it, vi } from "vitest";

import { PrismaConversationHistoryRepository } from "../db/prisma-conversation-history-repository";

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
});
