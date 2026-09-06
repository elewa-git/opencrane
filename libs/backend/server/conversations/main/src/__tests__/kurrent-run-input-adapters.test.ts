import { describe, expect, it, vi } from "vitest";

import type { MessageEntry } from "@opencrane/contracts";

import { ConversationHistoryReader } from "../conversation-history-reader";
import { PrismaKurrentConversationPromptMessageRepository } from "../db/prisma-kurrent-conversation-prompt-message-repository";
import { KurrentConversationHistoryAdmissionReader } from "../kurrent-conversation-history-admission-reader";

/** Build one completed human message with exact identity and encrypted-payload evidence. */
function _Message(id: string, position: string): MessageEntry
{
	return { schemaVersion: 1, id, conversationId: "conversation-1", position, author: { kind: "human", principalId: "principal-1", participantId: "subject-1", issuer: "https://issuer.example", authenticatedAt: "2026-09-06T00:00:00.000Z", name: "Jente", avatarArtifactRevisionId: null }, provenance: "human-authored", visibility: { audience: "conversation" }, runId: null, causationId: id, correlationId: id, idempotencyKey: id, occurredAt: "2026-09-06T00:00:00.000Z", attestation: null, kind: "message", state: "completed", blocks: [{ id: `block-${id}`, kind: "text", payloadRef: `payload-${id}`, ciphertextDigest: `sha256:${id}` }], replyToEntryId: null, addressedAgentIdentityId: null, activation: "start" };
}

describe("Kurrent run-input adapters", function _KurrentRunInputAdaptersSuite()
{
	it("returns exact revision, order, and final immutable human author", async function _ReadAdmissionHistory()
	{
		const first = _Message("message-1", "1");
		const final = _Message("message-2", "2");
		vi.spyOn(ConversationHistoryReader.prototype, "read").mockResolvedValue({ streamName: "conversation-conversation-1", genesis: {} as never, entries: [first, final] });
		const reader = new KurrentConversationHistoryAdmissionReader({} as never);

		await expect(reader.read({ siloId: "silo-1", conversationId: "conversation-1", expectedRevision: "2" })).resolves.toEqual({ historyRevision: "2", orderedMessageIds: ["message-1", "message-2"], finalMessageAuthor: { principalId: "principal-1", issuer: "https://issuer.example", subjectId: "subject-1", authenticatedAt: "2026-09-06T00:00:00.000Z" } });
		await expect(reader.read({ siloId: "silo-1", conversationId: "conversation-1", expectedRevision: "1" })).resolves.toBeNull();
	});

	it("decrypts only payload rows whose complete history binding matches", async function _ReadPromptMessages()
	{
		const message = _Message("message-1", "1");
		vi.spyOn(ConversationHistoryReader.prototype, "read").mockResolvedValue({ streamName: "conversation-conversation-1", genesis: {} as never, entries: [message] });
		const payload = { id: "payload-message-1", siloId: "silo-1", conversationId: "conversation-1", authorSubject: "subject-1", keyId: "key-1", nonce: Buffer.from("nonce"), authTag: Buffer.from("tag"), ciphertext: Buffer.from("cipher"), ciphertextDigest: "sha256:message-1" };
		const prisma = { conversationPrivatePayload: { findMany: vi.fn().mockResolvedValue([payload]) } };
		const cipher = { decrypt: vi.fn().mockReturnValue("hello") };
		const source = new PrismaKurrentConversationPromptMessageRepository(prisma as never, {} as never, cipher as never, "silo-1", "conversation-1", "1");

		await expect(source.load(["message-1"])).resolves.toEqual([{ messageId: "message-1", message: { role: "user", content: "hello" } }]);
		expect(cipher.decrypt).toHaveBeenCalledOnce();
		expect(prisma.conversationPrivatePayload.findMany).toHaveBeenCalledWith({ where: { siloId: "silo-1", conversationId: "conversation-1", id: { in: ["payload-message-1"] } } });

		prisma.conversationPrivatePayload.findMany.mockResolvedValueOnce([{ ...payload, authorSubject: "subject-other" }]);
		await expect(source.load(["message-1"])).rejects.toThrow(/does not match canonical history/);
		prisma.conversationPrivatePayload.findMany.mockResolvedValueOnce([{ ...payload, ciphertextDigest: "sha256:other" }]);
		await expect(source.load(["message-1"])).rejects.toThrow(/does not match canonical history/);
	});
});
