import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaGroupChildShareUnitOfWork } from "../prisma-group-child-share";
import { PrismaConversationHistoryRepository } from "../../messages/db/prisma-conversation-history-repository";
import { PrismaConversationProductAuthorizationRepository } from "../../authorization/db/conversation-product-authorization";
import { ConversationHistoryReader } from "@opencrane/backend/server/conversations/history";
import { ConversationHistoryAuthority } from "@opencrane/backend/server/conversations/history";
import { ConversationHistoryAppendOutcomes } from "@opencrane/backend/server/conversations/history";
import { AesGcmConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";
import { GroupChildConflictError } from "../group-child.errors";

const _KEY = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";
const _SOURCE = "41c1f1dc-0010-4f13-9c2f-d3841ffd6651";
const _CALLER = { siloId: "silo", principalId: "principal", subjectId: "subject", externalIssuer: "https://issuer.test", verifiedAuthenticationAt: "2026-09-07T00:00:00.000Z" };
const _COMMAND = { sourceEntryId: _SOURCE, sourcePosition: "2", text: "Reviewed public summary", idempotencyKey: _KEY };

/** Preserves winning ciphertext and appended entries across retried sharing commands. */
function _Fixture()
{
	const state = { payload: null as any, entries: [] as any[], readable: true };
	const request = { id: "request", siloId: "silo", state: "Ready", childConversationId: "child", parentConversationId: "parent", parentMessageId: "origin", parentMessagePosition: 1n, participantSubjectIds: ["subject"], agentIdentityId: "managed-company", agentServiceId: "company" };
	const transaction = { conversationChildRequest: { findUnique: vi.fn(async () => request), findFirst: vi.fn(async () => request) }, conversation: { findFirst: vi.fn(async () => ({ id: "parent" })) } };
	const prisma = { $transaction: vi.fn(async (work: any) => work(transaction)) };
	vi.spyOn(PrismaConversationProductAuthorizationRepository.prototype, "canAccess").mockImplementation(async () => state.readable);
	vi.spyOn(PrismaConversationProductAuthorizationRepository.prototype, "admit").mockResolvedValue(true);
	vi.spyOn(PrismaConversationHistoryRepository.prototype, "authorizeRead").mockImplementation(async () => state.readable ? { authorName: "Human" } as never : null);
	vi.spyOn(PrismaConversationHistoryRepository.prototype, "authorizeWrite").mockImplementation(async () => state.readable ? { authorName: "Human" } as never : null);
	const persist = vi.spyOn(PrismaConversationHistoryRepository.prototype, "createOrReadPayload").mockImplementation(async (caller, conversationId, idempotencyKey, payloadRef, payload) =>
	{
		const existing = state.payload;
		state.payload ??= { ...payload, idempotencyKey, coordinates: { siloId: caller.siloId, conversationId, authorSubject: caller.subjectId, payloadRef } };
		return { created: existing === null, payload: state.payload };
	});
	vi.spyOn(ConversationHistoryReader.prototype, "read").mockImplementation(async () => ({ streamName: "conversation-parent", genesis: {} as never, entries: state.entries }));
	const append = vi.spyOn(ConversationHistoryAuthority.prototype, "append").mockImplementation(async command => { state.entries.push(command.entry); return { outcome: ConversationHistoryAppendOutcomes.Appended, receipt: { streamName: "conversation-parent", revision: BigInt(command.entry.position) } }; });
	const history = { read: vi.fn(async () => ({ entries: [{ id: _SOURCE, position: "2", kind: "message", state: "completed", author: { kind: "agent", agentIdentityId: "managed-company", agentServiceId: "company" }, blocks: [{ kind: "text", payloadRef: "source-private" }] }], payloads: { "source-private": "Original detailed assistant answer" }, nextPosition: "2", computer: null })) };
	const authority = new PrismaGroupChildShareUnitOfWork(prisma as never, {} as never, new AesGcmConversationPrivatePayloadCipher("key", { key: Buffer.alloc(32, 8).toString("base64url") }), history as never, {} as never, {} as never, new ConversationHistoryAuthority({} as never));
	return { state, transaction, authority, history, append, persist };
}

describe("human-reviewed group result sharing", () =>
{
	beforeEach(() => vi.clearAllMocks());
	afterEach(() => vi.restoreAllMocks());
	it("posts the edited text as the human with verified child causation and parent reply", async () =>
	{
		const f = _Fixture();
		expect(await f.authority.share(_CALLER, "child", _COMMAND)).toEqual({ outcome: "accepted", position: "1" });
		expect(f.state.entries[0]).toMatchObject({ author: { kind: "human", principalId: "principal" }, provenance: "human-authored", causationId: _SOURCE, correlationId: "request", replyToEntryId: "origin", addressedAgentIdentityId: null, activation: "none" });
		expect(f.state.entries[0].blocks[0].payloadRef).not.toBe("source-private");
		expect(JSON.stringify(f.state.entries)).not.toContain(_COMMAND.text);
		expect(f.history.read).toHaveBeenCalledWith(_CALLER, "child", 1n, expect.objectContaining({ maxCount: 1, signal: expect.any(AbortSignal) }));
	});
	it("returns the original position on retry and rejects edited text under the same UUID", async () =>
	{
		const f = _Fixture(); await f.authority.share(_CALLER, "child", _COMMAND);
		expect(await f.authority.share(_CALLER, "child", _COMMAND)).toEqual({ outcome: "idempotent", position: "1" });
		await expect(f.authority.share(_CALLER, "child", { ..._COMMAND, text: "Changed after review" })).rejects.toBeInstanceOf(GroupChildConflictError);
		expect(f.append).toHaveBeenCalledTimes(1);
	});
	it("rejects a source position that does not contain the selected entry before persistence", async () =>
	{
		const f = _Fixture();
		expect(await f.authority.share(_CALLER, "child", { ..._COMMAND, sourcePosition: "3" })).toBeNull();
		expect(f.persist).not.toHaveBeenCalled();
		expect(f.append).not.toHaveBeenCalled();
	});
	it("rejects a response from a different assistant", async () =>
	{
		const f = _Fixture(); const page = await f.history.read(); page.entries[0]!.author.agentIdentityId = "foreign"; f.history.read.mockResolvedValue(page);
		expect(await f.authority.share(_CALLER, "child", _COMMAND)).toBeNull();
		expect(f.persist).not.toHaveBeenCalled();
	});
	it("stops sharing before plaintext or persistence when parent authority ends", async () =>
	{
		const f = _Fixture(); f.state.readable = false;
		expect(await f.authority.share(_CALLER, "child", _COMMAND)).toBeNull();
		expect(f.history.read).not.toHaveBeenCalled();
		expect(f.persist).not.toHaveBeenCalled();
	});
	it("rechecks revocation after the selected source read and before copying reviewed text", async () =>
	{
		const f = _Fixture(); const page = await f.history.read(); f.history.read.mockImplementation(async () => { f.state.readable = false; return page; });
		expect(await f.authority.share(_CALLER, "child", _COMMAND)).toBeNull();
		expect(f.persist).not.toHaveBeenCalled();
		expect(f.append).not.toHaveBeenCalled();
	});
	it("rechecks parent and child authority after Kurrent catch-up and before the physical parent append", async () =>
	{
		const f = _Fixture();
		vi.mocked(ConversationHistoryReader.prototype.read).mockImplementation(async () => { f.state.readable = false; return { streamName: "conversation-parent", genesis: {} as never, entries: [] }; });
		expect(await f.authority.share(_CALLER, "child", _COMMAND)).toBeNull();
		expect(f.append).not.toHaveBeenCalled();
	});

});
