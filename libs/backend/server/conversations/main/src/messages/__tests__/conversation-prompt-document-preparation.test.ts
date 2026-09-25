import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationHistoryReader } from "@opencrane/backend/server/conversations/history";
import type { MessageEntry } from "@opencrane/contracts";

import { PrismaConversationPromptDocumentPreparationUnitOfWork } from "../prisma-conversation-prompt-document-preparation-unit-of-work";
import type { ConversationPromptDocumentPreparationCommand, ResolvedConversationPromptDocument } from "../conversation-prompt-document.types";

const _COMMAND: ConversationPromptDocumentPreparationCommand = {
	siloId: "silo-1", conversationId: "conversation-1", historyRevision: "1", orderedMessageIds: ["message-1"],
	requester: { siloId: "silo-1", principalId: "principal-1", subjectId: "user-1", externalIssuer: "https://issuer.example", verifiedAuthenticationAt: "2026-09-12T00:00:00.000Z" },
};

/** Build one completed human message containing the requested PDF blocks in order. */
function _Message(count = 1): MessageEntry
{
	return { schemaVersion: 1, id: "message-1", conversationId: "conversation-1", position: "1",
		author: { kind: "human", principalId: "principal-1", participantId: "user-1", issuer: "https://issuer.example", authenticatedAt: "2026-09-12T00:00:00.000Z", name: "Jente", avatarArtifactRevisionId: null },
		provenance: "human-authored", visibility: { audience: "conversation" }, runId: null, causationId: "message-1", correlationId: "message-1", idempotencyKey: "message-1", occurredAt: "2026-09-12T00:00:00.000Z", attestation: null,
		kind: "message", state: "completed", blocks: Array.from({ length: count }, function _Block(_, index) { return { id: `block-${index}`, kind: "artifact" as const, artifactId: `source-${index}`, artifactRevisionId: `source-revision-${index}`, name: `report-${index}.pdf`, mediaType: "application/pdf" }; }), replyToEntryId: null, addressedAgentIdentityId: null, activation: "start" };
}

/** Supply SQL-resolved coordinates for one Kurrent block and exact converted bytes. */
function _Resolved(index: number, bytes: Uint8Array): ResolvedConversationPromptDocument
{
	return { siloId: "silo-1", messageId: "message-1", blockId: `block-${index}`, sourceArtifactId: `source-${index}`, sourceRevisionId: `source-revision-${index}`,
		name: `report-${index}.pdf`, mediaType: "application/pdf", conversationAssetId: `asset-${index}`, sourceByteLength: 100,
		artifactId: `text-${index}`, artifactRevisionId: `text-revision-${index}`, contentAddress: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
		byteLength: bytes.byteLength, derivedMediaType: "text/plain" };
}

/** Return a one-chunk browser stream without adding storage behavior to the fixture. */
function _Stream(bytes: Uint8Array): ReadableStream<Uint8Array>
{
	return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
}

/** Compose the preparation owner while exposing whether external bytes were read inside SQL. */
function _Fixture(resolved: readonly ResolvedConversationPromptDocument[], returned: Uint8Array[])
{
	let transactionOpen = false;
	const authority = { resolve: vi.fn(async function _Resolve() { expect(transactionOpen).toBe(true); return resolved; }), revalidate: vi.fn() };
	const prisma = { $transaction: vi.fn(async function _Transaction(work: (transaction: object) => Promise<unknown>) { transactionOpen = true; try { return await work({}); } finally { transactionOpen = false; } }) };
	const content = { read: vi.fn(async function _Read(_input: unknown, signal?: AbortSignal) { expect(transactionOpen).toBe(false); expect(signal).toBeInstanceOf(AbortSignal); return _Stream(returned.shift()!); }) };
	return { authority, content, preparer: new PrismaConversationPromptDocumentPreparationUnitOfWork(prisma as never, {} as never, { create: vi.fn().mockReturnValue(authority) }, content) };
}

afterEach(function _RestoreHistoryReader() { vi.restoreAllMocks(); });

describe("conversation prompt PDF preparation", function _ConversationPromptDocumentPreparationSuite()
{
	it("loads exact converted bytes after the authority transaction closes", async function _PrepareExactText()
	{
		const bytes = new TextEncoder().encode("Quarterly evidence.");
		vi.spyOn(ConversationHistoryReader.prototype, "read").mockResolvedValue({ streamName: "conversation-conversation-1", genesis: {} as never, entries: [_Message()] });
		const fixture = _Fixture([_Resolved(0, bytes)], [bytes]);

		await expect(fixture.preparer.prepare(_COMMAND)).resolves.toEqual(expect.objectContaining({ historyRevision: "1", documents: [expect.objectContaining({ text: "Quarterly evidence.", artifactRevisionId: "text-revision-0" })] }));
		expect(fixture.authority.resolve).toHaveBeenCalledOnce();
		expect(fixture.content.read).toHaveBeenCalledOnce();
	});

	it.each(["digest", "length", "utf8"])("refuses converted bytes with invalid %s evidence", async function _InvalidBytes(kind)
	{
		const valid = new TextEncoder().encode("valid");
		let returned = valid;
		if (kind === "utf8")
			returned = Uint8Array.from([0xff]);
		let resolved = _Resolved(0, returned);
		if (kind === "digest")
			resolved = { ...resolved, contentAddress: `sha256:${"0".repeat(64)}` };
		if (kind === "length")
			resolved = { ...resolved, byteLength: returned.byteLength + 1 };
		vi.spyOn(ConversationHistoryReader.prototype, "read").mockResolvedValue({ streamName: "conversation-conversation-1", genesis: {} as never, entries: [_Message()] });
		const fixture = _Fixture([resolved], [returned]);

		await expect(fixture.preparer.prepare(_COMMAND)).rejects.toThrow();
	});

	it("rejects aggregate converted text before opening ArtifactStore streams", async function _AggregateLimit()
	{
		const bytes = new Uint8Array(50 * 1_024);
		vi.spyOn(ConversationHistoryReader.prototype, "read").mockResolvedValue({ streamName: "conversation-conversation-1", genesis: {} as never, entries: [_Message(3)] });
		const fixture = _Fixture([_Resolved(0, bytes), _Resolved(1, bytes), _Resolved(2, bytes)], [bytes, bytes, bytes]);

		await expect(fixture.preparer.prepare(_COMMAND)).rejects.toThrow("aggregate byte limit");
		expect(fixture.content.read).not.toHaveBeenCalled();
	});

	it("rejects one converted document above 64 KiB before opening ArtifactStore", async function _DocumentLimit()
	{
		const bytes = new Uint8Array(64 * 1_024 + 1);
		vi.spyOn(ConversationHistoryReader.prototype, "read").mockResolvedValue({ streamName: "conversation-conversation-1", genesis: {} as never, entries: [_Message()] });
		const fixture = _Fixture([_Resolved(0, bytes)], [bytes]);

		await expect(fixture.preparer.prepare(_COMMAND)).rejects.toThrow("PDF text exceeds its byte limit");
		expect(fixture.content.read).not.toHaveBeenCalled();
	});

	it("rejects more than ten PDF blocks before opening a SQL transaction", async function _DocumentCountLimit()
	{
		vi.spyOn(ConversationHistoryReader.prototype, "read").mockResolvedValue({ streamName: "conversation-conversation-1", genesis: {} as never, entries: [_Message(11)] });
		const fixture = _Fixture([], []);

		await expect(fixture.preparer.prepare(_COMMAND)).rejects.toThrow("document count limit");
		expect(fixture.authority.resolve).not.toHaveBeenCalled();
	});
});
