import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationAuthorKinds, ConversationEntryKinds, ConversationMessageContentBlockKinds, type MessageEntry } from "@opencrane/contracts";
import type { SelfConversationHistoryResult } from "../../../messages/self-conversation-history.types";
import { PrismaConversationHistoryRepository } from "../../../messages/db/prisma-conversation-history-repository";
import { PrismaKurrentPersonalMemoryMessageSource } from "../prisma-kurrent-personal-memory-message-source";
import { PrismaPersonalMemoryMessageSourceRepository } from "../prisma-personal-memory-message-source-repository";

const _CALLER = { siloId: "silo-1", subjectId: "subject-1", principalId: "principal-1" } as const;
const _CONVERSATION_ID = "conversation-1";
const _MESSAGE_ID = "message-1";
const _POSITION = 4n;
const _PAYLOAD_REF = "payload-1";
const _CIPHERTEXT_DIGEST = `sha256:${"b".repeat(64)}`;
const _TEXT = "Remember this sentence.";

afterEach(function _Restore() { vi.restoreAllMocks(); });

describe("personal-memory conversation source", function _SourceSuite()
{
	it("reads the exact position after later history was appended", async function _LaterAppend()
	{
		const history = { read: vi.fn(async function _Read(_caller, _conversationId, afterPosition, options): Promise<SelfConversationHistoryResult>
		{
			expect(afterPosition).toBe(_POSITION - 1n);
			expect(options).toMatchObject({ maxCount: 1, maximumBytes: 131_072 });
			return _Page(_Entry());
		}) };
		const reader = new PrismaKurrentPersonalMemoryMessageSource(history);

		await expect(reader.read(_CALLER, _CONVERSATION_ID, _MESSAGE_ID, _POSITION)).resolves.toEqual({ source: _Source(), text: _TEXT, contentDigest: _Digest(_TEXT) });
	});

	it.each([
		["wrong message id", { id: "message-2" }],
		["wrong position", { position: "5" }],
		["pending state", { state: "pending" }],
		["agent provenance", { provenance: "agent-authored" }],
		["other principal", { author: { ..._HumanAuthor(), principalId: "principal-2" } }],
		["other participant", { author: { ..._HumanAuthor(), participantId: "subject-2" } }],
		["non-text block", { blocks: [{ id: "block-1", kind: ConversationMessageContentBlockKinds.Artifact, artifactId: "artifact-1", artifactRevisionId: "revision-1", name: "file", mediaType: "text/plain" }] }],
	])("rejects %s before returning source text", async function _Reject(_name, change)
	{
		const history = { read: vi.fn().mockResolvedValue(_Page({ ..._Entry(), ...change } as MessageEntry)) };
		const reader = new PrismaKurrentPersonalMemoryMessageSource(history);
		await expect(reader.read(_CALLER, _CONVERSATION_ID, _MESSAGE_ID, _POSITION)).resolves.toBeNull();
	});

	it("rejects a missing payload or an oversized UTF-8 result", async function _PayloadBounds()
	{
		const missing = new PrismaKurrentPersonalMemoryMessageSource({ read: vi.fn().mockResolvedValue(_Page(_Entry(), {})) });
		await expect(missing.read(_CALLER, _CONVERSATION_ID, _MESSAGE_ID, _POSITION)).resolves.toBeNull();
		const blank = new PrismaKurrentPersonalMemoryMessageSource({ read: vi.fn().mockResolvedValue(_Page(_Entry(), { [_PAYLOAD_REF]: "  \n\t" })) });
		await expect(blank.read(_CALLER, _CONVERSATION_ID, _MESSAGE_ID, _POSITION)).resolves.toBeNull();
		const oversized = new PrismaKurrentPersonalMemoryMessageSource({ read: vi.fn().mockResolvedValue(_Page(_Entry(), { [_PAYLOAD_REF]: "x".repeat(65_537) })) });
		await expect(oversized.read(_CALLER, _CONVERSATION_ID, _MESSAGE_ID, _POSITION)).resolves.toBeNull();
	});

	it("stops before the history authority when its caller signal is aborted", async function _Abort()
	{
		const stop = new AbortController();
		stop.abort();
		const read = vi.fn();
		const reader = new PrismaKurrentPersonalMemoryMessageSource({ read });
		await expect(reader.read(_CALLER, _CONVERSATION_ID, _MESSAGE_ID, _POSITION, stop.signal)).rejects.toThrow();
		expect(read).not.toHaveBeenCalled();
	});
});

describe("personal-memory source transaction revalidation", function _RevalidationSuite()
{
	it("accepts one exact current payload row", async function _Exact()
	{
		const authority = vi.spyOn(PrismaConversationHistoryRepository.prototype, "authorizeRead").mockResolvedValue({ visibleFromPosition: 1n } as never);
		const payloads = vi.spyOn(PrismaConversationHistoryRepository.prototype, "readPayloads").mockResolvedValue([_StoredPayload()] as never);
		const verifier = new PrismaPersonalMemoryMessageSourceRepository({} as Prisma.TransactionClient);

		await expect(verifier.revalidate(_CALLER, _Source())).resolves.toBe(true);
		expect(authority).toHaveBeenCalledWith(_CALLER, _CONVERSATION_ID);
		expect(payloads).toHaveBeenCalledWith(_CALLER, _CONVERSATION_ID, [_PAYLOAD_REF]);
	});

	it("denies source evidence attributed to another principal", async function _WrongPrincipal()
	{
		vi.spyOn(PrismaConversationHistoryRepository.prototype, "authorizeRead").mockResolvedValue({ visibleFromPosition: 1n } as never);
		const payloads = vi.spyOn(PrismaConversationHistoryRepository.prototype, "readPayloads").mockResolvedValue([_StoredPayload()] as never);
		const verifier = new PrismaPersonalMemoryMessageSourceRepository({} as Prisma.TransactionClient);

		await expect(verifier.revalidate(_CALLER, { ..._Source(), authorPrincipalId: "principal-2" })).resolves.toBe(false);
		expect(payloads).not.toHaveBeenCalled();
	});

	it("denies revoked access, a hidden pre-join source, missing or duplicate payloads", async function _DeniedRows()
	{
		const authority = vi.spyOn(PrismaConversationHistoryRepository.prototype, "authorizeRead");
		const payloads = vi.spyOn(PrismaConversationHistoryRepository.prototype, "readPayloads");
		const verifier = new PrismaPersonalMemoryMessageSourceRepository({} as Prisma.TransactionClient);

		authority.mockResolvedValueOnce(null);
		await expect(verifier.revalidate(_CALLER, _Source())).resolves.toBe(false);
		authority.mockResolvedValueOnce({ visibleFromPosition: _POSITION + 1n } as never);
		await expect(verifier.revalidate(_CALLER, _Source())).resolves.toBe(false);
		authority.mockResolvedValue({ visibleFromPosition: 1n } as never);
		for (const rows of [[], [_StoredPayload(), _StoredPayload()]])
		{
			payloads.mockResolvedValueOnce(rows as never);
			await expect(verifier.revalidate(_CALLER, _Source())).resolves.toBe(false);
		}
	});

	it.each([
		["different silo", { coordinates: { ..._StoredPayload().coordinates, siloId: "silo-2" } }],
		["different conversation", { coordinates: { ..._StoredPayload().coordinates, conversationId: "conversation-2" } }],
		["different payload reference", { coordinates: { ..._StoredPayload().coordinates, payloadRef: "payload-2" } }],
		["different author", { coordinates: { ..._StoredPayload().coordinates, authorSubject: "subject-2" } }],
		["changed ciphertext digest", { ciphertextDigest: `sha256:${"c".repeat(64)}` }],
	])("denies %s", async function _Changed(_name, change)
	{
		vi.spyOn(PrismaConversationHistoryRepository.prototype, "authorizeRead").mockResolvedValue({ visibleFromPosition: 1n } as never);
		vi.spyOn(PrismaConversationHistoryRepository.prototype, "readPayloads").mockResolvedValue([{ ..._StoredPayload(), ...change } as never]);
		const verifier = new PrismaPersonalMemoryMessageSourceRepository({} as Prisma.TransactionClient);
		await expect(verifier.revalidate(_CALLER, _Source())).resolves.toBe(false);
	});
});

function _Entry(): MessageEntry
{
	return { schemaVersion: 1, id: _MESSAGE_ID, conversationId: _CONVERSATION_ID, position: _POSITION.toString(), author: _HumanAuthor(), provenance: "human-authored", visibility: { audience: "conversation" }, runId: null, causationId: _MESSAGE_ID, correlationId: _MESSAGE_ID, idempotencyKey: _MESSAGE_ID, occurredAt: "2026-09-13T08:00:00.000Z", attestation: null, kind: ConversationEntryKinds.Message, state: "completed", blocks: [{ id: "block-1", kind: ConversationMessageContentBlockKinds.Text, payloadRef: _PAYLOAD_REF, ciphertextDigest: _CIPHERTEXT_DIGEST }], replyToEntryId: null, addressedAgentIdentityId: null, activation: "none" };
}

function _HumanAuthor(): MessageEntry["author"]
{
	return { kind: ConversationAuthorKinds.Human, principalId: _CALLER.principalId, participantId: _CALLER.subjectId, issuer: "issuer-1", authenticatedAt: "2026-09-13T07:59:00.000Z", name: "Participant", avatarArtifactRevisionId: null };
}

function _Page(entry: MessageEntry, payloads: Readonly<Record<string, string>> = { [_PAYLOAD_REF]: _TEXT }): SelfConversationHistoryResult
{
	return { entries: [entry], payloads, nextPosition: entry.position, computer: null };
}

function _Source()
{
	return { conversationId: _CONVERSATION_ID, messageId: _MESSAGE_ID, messagePosition: _POSITION, payloadRef: _PAYLOAD_REF, ciphertextDigest: _CIPHERTEXT_DIGEST, authorPrincipalId: _CALLER.principalId };
}

function _StoredPayload()
{
	return { coordinates: { siloId: _CALLER.siloId, conversationId: _CONVERSATION_ID, payloadRef: _PAYLOAD_REF, authorSubject: _CALLER.subjectId }, idempotencyKey: "retry-1", keyId: "key-1", nonce: new Uint8Array([1]), authTag: new Uint8Array([2]), ciphertext: new Uint8Array([3]), ciphertextDigest: _CIPHERTEXT_DIGEST };
}

function _Digest(value: string): string
{
	return `sha256:${createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex")}`;
}
