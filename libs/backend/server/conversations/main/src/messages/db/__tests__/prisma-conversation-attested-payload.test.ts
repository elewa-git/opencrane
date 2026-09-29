import { describe, expect, it, vi } from "vitest";

import type { ConversationAttestedPayloadCommand } from "../prisma-conversation-history-repository.types";
import { PrismaConversationHistoryRepository } from "../prisma-conversation-history-repository";

/** Encrypted payload supplied by the routine owner after current preparation admission. */
const _ENCRYPTED = { keyId: "key-1", nonce: new Uint8Array(12), authTag: new Uint8Array(16), ciphertext: new Uint8Array([1, 2, 3]), ciphertextDigest: `sha256:${"a".repeat(64)}` };

/** Exact service-attested command whose author is fixed by the repository. */
const _COMMAND: ConversationAttestedPayloadCommand = { siloId: "silo-1", conversationId: "occurrence-1", idempotencyKey: "routine-firing-1", payloadRef: "payload-1", payload: _ENCRYPTED };

/** Builds the persisted row corresponding to the exact attested command. */
function _Row(overrides: Record<string, unknown> = {})
{
	return { id: _COMMAND.payloadRef, siloId: _COMMAND.siloId, conversationId: _COMMAND.conversationId, authorSubject: "opencrane", idempotencyKey: _COMMAND.idempotencyKey, keyId: _ENCRYPTED.keyId, nonce: Buffer.from(_ENCRYPTED.nonce), authTag: Buffer.from(_ENCRYPTED.authTag), ciphertext: Buffer.from(_ENCRYPTED.ciphertext), ciphertextDigest: _ENCRYPTED.ciphertextDigest, ...overrides };
}

/** Provides the exact Prisma delegates used by attested payload persistence. */
function _Fixture(existing: ReturnType<typeof _Row> | null)
{
	const transaction = {
		conversationPrivatePayload: { findUnique: vi.fn().mockResolvedValue(existing), create: vi.fn().mockResolvedValue(_Row()) },
		conversation: { update: vi.fn().mockResolvedValue({ id: _COMMAND.conversationId }) },
	};
	return { transaction, repository: new PrismaConversationHistoryRepository(transaction as never) };
}

describe("PrismaConversationHistoryRepository attested payload", function _Suite()
{
	it("stores a new OpenCrane-authored ciphertext and advances conversation ordering", async function _Create()
	{
		const fixture = _Fixture(null);

		await expect(fixture.repository.createOrReadAttestedPayload(_COMMAND)).resolves.toMatchObject({ created: true, payload: { coordinates: { siloId: _COMMAND.siloId, conversationId: _COMMAND.conversationId, payloadRef: _COMMAND.payloadRef, authorSubject: "opencrane" }, ciphertextDigest: _ENCRYPTED.ciphertextDigest } });
		expect(fixture.transaction.conversationPrivatePayload.findUnique).toHaveBeenCalledWith({ where: { conversationId_authorSubject_idempotencyKey: { conversationId: _COMMAND.conversationId, authorSubject: "opencrane", idempotencyKey: _COMMAND.idempotencyKey } } });
		expect(fixture.transaction.conversationPrivatePayload.create).toHaveBeenCalledWith({ data: { id: _COMMAND.payloadRef, siloId: _COMMAND.siloId, conversationId: _COMMAND.conversationId, authorSubject: "opencrane", idempotencyKey: _COMMAND.idempotencyKey, keyId: _ENCRYPTED.keyId, nonce: Buffer.from(_ENCRYPTED.nonce), authTag: Buffer.from(_ENCRYPTED.authTag), ciphertext: Buffer.from(_ENCRYPTED.ciphertext), ciphertextDigest: _ENCRYPTED.ciphertextDigest } });
		expect(fixture.transaction.conversation.update).toHaveBeenCalledWith({ where: { id_siloId: { id: _COMMAND.conversationId, siloId: _COMMAND.siloId } }, data: { updatedAt: expect.any(Date) }, select: { id: true } });
		expect(fixture.transaction.conversation.update.mock.invocationCallOrder[0]).toBeGreaterThan(fixture.transaction.conversationPrivatePayload.create.mock.invocationCallOrder[0]!);
	});

	it("returns the first ciphertext on an exact retry without another mutation", async function _Retry()
	{
		const row = _Row({ ciphertext: Buffer.from([9]), ciphertextDigest: `sha256:${"b".repeat(64)}` });
		const fixture = _Fixture(row);
		const retried = { ..._COMMAND, payload: { ..._ENCRYPTED, ciphertext: new Uint8Array([7]), ciphertextDigest: `sha256:${"c".repeat(64)}` } };

		await expect(fixture.repository.createOrReadAttestedPayload(retried)).resolves.toMatchObject({ created: false, payload: { ciphertext: row.ciphertext, ciphertextDigest: row.ciphertextDigest } });
		expect(fixture.transaction.conversationPrivatePayload.create).not.toHaveBeenCalled();
		expect(fixture.transaction.conversation.update).not.toHaveBeenCalled();
	});

	it("recovers an exact existing ciphertext in required-existing mode without mutation", async function _RequiredExistingRetry()
	{
		const row = _Row({ ciphertext: Buffer.from([9]), ciphertextDigest: `sha256:${"b".repeat(64)}` });
		const fixture = _Fixture(row);

		await expect(fixture.repository.createOrReadAttestedPayload({ ..._COMMAND, requireExisting: true })).resolves.toMatchObject({ created: false, payload: { ciphertext: row.ciphertext, ciphertextDigest: row.ciphertextDigest } });
		expect(fixture.transaction.conversationPrivatePayload.create).not.toHaveBeenCalled();
		expect(fixture.transaction.conversation.update).not.toHaveBeenCalled();
	});

	it("refuses published recovery when the attested ciphertext is missing", async function _RequiredExistingMissing()
	{
		const fixture = _Fixture(null);

		await expect(fixture.repository.createOrReadAttestedPayload({ ..._COMMAND, requireExisting: true })).rejects.toThrow("recovery requires its stored ciphertext");
		expect(fixture.transaction.conversationPrivatePayload.create).not.toHaveBeenCalled();
		expect(fixture.transaction.conversation.update).not.toHaveBeenCalled();
	});

	it.each([
		["payload reference", { id: "other-payload" }],
		["silo", { siloId: "other-silo" }],
		["conversation", { conversationId: "other-conversation" }],
		["author", { authorSubject: "human-subject" }],
	])("rejects a stored retry with conflicting %s coordinates before mutation", async function _Conflict(_name, overrides)
	{
		const fixture = _Fixture(_Row(overrides));

		await expect(fixture.repository.createOrReadAttestedPayload(_COMMAND)).rejects.toThrow("does not match its stored coordinates");
		expect(fixture.transaction.conversationPrivatePayload.create).not.toHaveBeenCalled();
		expect(fixture.transaction.conversation.update).not.toHaveBeenCalled();
	});

	it.each([
		["silo", { siloId: " " }],
		["conversation", { conversationId: " occurrence-1" }],
		["retry key", { idempotencyKey: "" }],
		["payload reference", { payloadRef: "payload-1 " }],
	])("rejects an invalid %s coordinate before reading or mutation", async function _Invalid(_name, change)
	{
		const fixture = _Fixture(null);

		await expect(fixture.repository.createOrReadAttestedPayload({ ..._COMMAND, ...change })).rejects.toThrow("requires an exact");
		expect(fixture.transaction.conversationPrivatePayload.findUnique).not.toHaveBeenCalled();
		expect(fixture.transaction.conversationPrivatePayload.create).not.toHaveBeenCalled();
		expect(fixture.transaction.conversation.update).not.toHaveBeenCalled();
	});
});
