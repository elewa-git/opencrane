import { describe, expect, it, vi } from "vitest";

import type { MessageEntry } from "@opencrane/contracts";

import { PrismaConversationHistoryRepository } from "../db/prisma-conversation-history-repository";
import { ConversationHistoryReader } from "@opencrane/backend/server/conversations/history";
import { PrismaKurrentConversationPromptMessageRepository } from "../db/prisma-kurrent-conversation-prompt-message-repository";
import { KurrentConversationHistoryAdmissionReader } from "../kurrent-conversation-history-admission-reader";

const _CALLER = { siloId: "silo-1", principalId: "principal-1", subjectId: "subject-1", externalIssuer: "https://issuer.example", verifiedAuthenticationAt: "2026-09-06T00:00:00.000Z" };
const _PREPARED = { siloId: "silo-1", conversationId: "conversation-1", historyRevision: "1", orderedMessageIds: ["message-1"], documents: [] } as const;

/** Supplies the transaction revalidator even when this fixture has no PDF blocks. */
function _Documents() { return { revalidate: vi.fn().mockResolvedValue(undefined), resolve: vi.fn() }; }

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
		const prisma = { conversationChildRequest: { findUnique: vi.fn().mockResolvedValue(null) }, conversationPrivatePayload: { findMany: vi.fn().mockResolvedValue([payload]) } };
		const cipher = { decrypt: vi.fn().mockReturnValue("hello") };
		const source = new PrismaKurrentConversationPromptMessageRepository(prisma as never, {} as never, cipher as never, "silo-1", "conversation-1", "1", _PREPARED, _Documents(), _CALLER);

		await expect(source.load(["message-1"])).resolves.toEqual([{ messageId: "message-1", message: { role: "user", content: "hello" } }]);
		expect(cipher.decrypt).toHaveBeenCalledOnce();
		expect(prisma.conversationPrivatePayload.findMany).toHaveBeenCalledWith({ where: { siloId: "silo-1", conversationId: "conversation-1", id: { in: ["payload-message-1"] } } });

		prisma.conversationPrivatePayload.findMany.mockResolvedValueOnce([{ ...payload, authorSubject: "subject-other" }]);
		await expect(source.load(["message-1"])).rejects.toThrow(/does not match canonical history/);
		prisma.conversationPrivatePayload.findMany.mockResolvedValueOnce([{ ...payload, ciphertextDigest: "sha256:other" }]);
		await expect(source.load(["message-1"])).rejects.toThrow(/does not match canonical history/);
	});

	it("adds the same revalidated PDF text on initial and restart compilation", async function _ReadPromptDocument()
	{
		const message = { ..._Message("message-1", "1"), blocks: [..._Message("message-1", "1").blocks, { id: "pdf-block", kind: "artifact" as const, artifactId: "source-1", artifactRevisionId: "source-revision-1", name: "report.pdf", mediaType: "application/pdf" }] };
		vi.spyOn(ConversationHistoryReader.prototype, "read").mockResolvedValue({ streamName: "conversation-conversation-1", genesis: {} as never, entries: [message] });
		const payload = { id: "payload-message-1", siloId: "silo-1", conversationId: "conversation-1", authorSubject: "subject-1", keyId: "key-1", nonce: Buffer.from("nonce"), authTag: Buffer.from("tag"), ciphertext: Buffer.from("cipher"), ciphertextDigest: "sha256:message-1" };
		const prisma = { conversationChildRequest: { findUnique: vi.fn().mockResolvedValue(null) }, conversationPrivatePayload: { findMany: vi.fn().mockResolvedValue([payload]) } };
		const documents = _Documents();
		const prepared = { ..._PREPARED, documents: [{ siloId: "silo-1", messageId: "message-1", blockId: "pdf-block", sourceArtifactId: "source-1", sourceRevisionId: "source-revision-1", name: "report.pdf", mediaType: "application/pdf", conversationAssetId: "asset-1", sourceByteLength: 50, artifactId: "text-1", artifactRevisionId: "text-revision-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 8, derivedMediaType: "text/plain", text: "evidence" }] } as const;
		const source = new PrismaKurrentConversationPromptMessageRepository(prisma as never, {} as never, { decrypt: vi.fn().mockReturnValue("question") } as never, "silo-1", "conversation-1", "1", prepared, documents, _CALLER);

		const loaded = await source.load(["message-1"]);
		const replayed = await source.load(["message-1"]);

		expect(documents.revalidate).toHaveBeenCalledTimes(2);
		expect(documents.revalidate).toHaveBeenCalledWith(expect.objectContaining({ requester: _CALLER }), prepared);
		expect(replayed).toEqual(loaded);
		expect(loaded[0]?.message.role).toBe("user");
		expect(loaded[0]?.message.content).toContain("question\n\nOpenCrane untrusted PDF reference data");
		expect(loaded[0]?.message.content).toContain("Text 8:evidence");
	});

	it("refuses prepared text when transaction revalidation loses authority", async function _RevokedPromptDocument()
	{
		const message = _Message("message-1", "1");
		vi.spyOn(ConversationHistoryReader.prototype, "read").mockResolvedValue({ streamName: "conversation-conversation-1", genesis: {} as never, entries: [message] });
		const prisma = { conversationChildRequest: { findUnique: vi.fn().mockResolvedValue(null) }, conversationPrivatePayload: { findMany: vi.fn() } };
		const documents = { resolve: vi.fn(), revalidate: vi.fn().mockRejectedValue(new Error("revoked")) };
		const source = new PrismaKurrentConversationPromptMessageRepository(prisma as never, {} as never, {} as never, "silo-1", "conversation-1", "1", _PREPARED, documents, _CALLER);

		await expect(source.load(["message-1"])).rejects.toThrow("revoked");
		expect(prisma.conversationPrivatePayload.findMany).not.toHaveBeenCalled();
	});
	it("refuses child prompt decryption when the separate requester is absent", async function ()
	{
		const prisma = { conversationChildRequest: { findUnique: vi.fn().mockResolvedValue({ id: "request" }) }, conversationPrivatePayload: { findMany: vi.fn() } };
		const cipher = { decrypt: vi.fn() };
		const source = new PrismaKurrentConversationPromptMessageRepository(prisma as never, {} as never, cipher as never, "silo-1", "conversation-1", "1", _PREPARED, _Documents());
		await expect(source.load(["message-1"])).rejects.toThrow("current parent and child authority");
		expect(prisma.conversationPrivatePayload.findMany).not.toHaveBeenCalled();
		expect(cipher.decrypt).not.toHaveBeenCalled();
	});

	it("rechecks the requester at child prompt decryption instead of borrowing company identity", async function ()
	{
		const authorize = vi.spyOn(PrismaConversationHistoryRepository.prototype, "authorizeRead").mockResolvedValue(null);
		try
		{
			const prisma = { conversationChildRequest: { findUnique: vi.fn().mockResolvedValue({ id: "request" }) }, conversationPrivatePayload: { findMany: vi.fn() } };
			const cipher = { decrypt: vi.fn() };
			const caller = { siloId: "silo-1", principalId: "human-principal", subjectId: "human-subject" };
			const source = new PrismaKurrentConversationPromptMessageRepository(prisma as never, {} as never, cipher as never, "silo-1", "conversation-1", "1", _PREPARED, _Documents(), caller);
			await expect(source.load(["message-1"])).rejects.toThrow("current parent and child authority");
			expect(authorize).toHaveBeenCalledWith(caller, "conversation-1");
			expect(prisma.conversationPrivatePayload.findMany).not.toHaveBeenCalled();
			expect(cipher.decrypt).not.toHaveBeenCalled();
		}
		finally { authorize.mockRestore(); }
	});

});
