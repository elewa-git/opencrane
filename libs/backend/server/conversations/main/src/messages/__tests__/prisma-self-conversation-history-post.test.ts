import { ConversationMode, Prisma, type ConversationPrivatePayload } from "@prisma/client";
import { ComputerLeaseStates, type HumanConversationAuthor, type MessageEntry } from "@opencrane/contracts";
import { ProductAuthorizationActions } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationHistoryAuthority } from "@opencrane/backend/server/conversations/history";
import { ConversationHistoryAppendOutcomes } from "@opencrane/backend/server/conversations/history";
import { ConversationHistoryReader } from "@opencrane/backend/server/conversations/history";
import { AesGcmConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";
import { PrismaSelfConversationHistoryUnitOfWork } from "../prisma-self-conversation-history";
import { ConversationMessageActivations } from "../self-conversation-history.types";
import { _ConversationAuthorizationFixture } from "../../authorization/__tests__/conversation-authorization.fixtures";

const _CALLER = { principalId: "principal-1", subjectId: "user-1", siloId: "silo-1", externalIssuer: "https://issuer.test", verifiedAuthenticationAt: "2026-09-08T00:00:00.000Z" };
const _COMMAND = { idempotencyKey: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", activation: ConversationMessageActivations.None, text: "Private message text must stay outside SQL", assetIds: [] };

/** Runs the real repositories, central authority and cipher with transactional delegate snapshots. */
function _Fixture()
{
	const state = { payload: null as ConversationPrivatePayload | null, audits: [] as unknown[], updates: 0, failOrdering: false };
	const transaction = {
		..._ConversationAuthorizationFixture(),
		conversationChildRequest: { findUnique: vi.fn().mockResolvedValue(null) },
		conversation: {
			findFirst: vi.fn().mockResolvedValue({ mode: ConversationMode.Direct, computerId: null, computerAgentIdentityId: null, computerProfileRevisionId: null, participants: [{ visibleFromPosition: 0n }] }),
			update: vi.fn(),
		},
		conversationPrivatePayload: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
	};
	const membership = { ...transaction.orgMembership, findUnique: vi.fn().mockResolvedValue({ status: "Active", displayName: "Human" }) };
	const client = { ...transaction, orgMembership: membership };
	const events: string[] = [];
	const prisma = { $transaction: vi.fn(async function _Transaction(work: (client: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: Prisma.TransactionIsolationLevel })
	{
		expect(options.isolationLevel).toBe(Prisma.TransactionIsolationLevel.Serializable);
		let payload = state.payload;
		const audits = [...state.audits];
		let updates = state.updates;
		client.auditDecision.create.mockImplementation(async function _Record({ data }: { data: object }) { events.push("admit"); audits.push(data); return {}; });
		client.conversationPrivatePayload.findFirst.mockImplementation(async function _Read() { return payload; });
		client.conversationPrivatePayload.findUnique.mockImplementation(async function _ReadParticipant() { return payload; });
		client.conversationPrivatePayload.create.mockImplementation(async function _Create({ data }: { data: ConversationPrivatePayload }) { events.push("payload"); payload = data; return data; });
		client.conversation.update.mockImplementation(async function _Order()
		{
			events.push("order");
			if (state.failOrdering)
				throw new Error("ordering transaction failed");
			updates += 1;
			return { id: "conversation-1" };
		});
		const result = await work(client as never);
		state.payload = payload;
		state.audits = audits;
		state.updates = updates;
		events.push("commit");
		return result;
	}) };
	const history = { readStream: vi.fn(), readHead: vi.fn(), append: vi.fn(), appendAtomic: vi.fn() };
	const read = vi.spyOn(ConversationHistoryReader.prototype, "read").mockResolvedValue({ entries: [], streamName: "conversation-conversation-1", genesis: {} as never });
	const append = vi.spyOn(ConversationHistoryAuthority.prototype, "append").mockImplementation(async function _Append() { events.push("append"); return { outcome: ConversationHistoryAppendOutcomes.Appended } as never; });
	const cipher = new AesGcmConversationPrivatePayloadCipher("key-1", { "key-1": Buffer.alloc(32, 7).toString("base64url") });
	const computerReader = { load: vi.fn() };
	const bindOrVerify = vi.fn().mockResolvedValue({ attachments: [] });
	const createAttachmentAdmission = vi.fn(function _Attachments() { return { bindOrVerify }; });
	const authority = new PrismaSelfConversationHistoryUnitOfWork(prisma as never, history, { cipher, computerReader }, new ConversationHistoryAuthority(history), createAttachmentAdmission);
	return { authority, client, state, events, prisma, read, append, computerReader, history, bindOrVerify, createAttachmentAdmission };
}

afterEach(function _Restore() { vi.restoreAllMocks(); });

describe("participant message transaction with the central authorization authority", function _Suite()
{
	it("records Use for encrypted payload coordinates before payload/order writes and appends after commit", async function _AdmitsMessage()
	{
		const f = _Fixture();
		await expect(f.authority.postMessage(_CALLER, "conversation-1", _COMMAND)).resolves.toMatchObject({ outcome: "accepted", position: "1" });
		expect(f.events).toEqual(["admit", "payload", "order", "commit", "append"]);
		expect(f.state.audits).toHaveLength(1);
		expect(f.state.audits[0]).toMatchObject({ action: ProductAuthorizationActions.Use, argumentsDigest: ___DigestCanonicalJson({ payloadRef: f.state.payload!.id, ciphertextDigest: f.state.payload!.ciphertextDigest, idempotencyKey: _COMMAND.idempotencyKey, activation: _COMMAND.activation, assetIds: [] }) });
		expect(JSON.stringify([f.state.payload, f.state.audits, f.client.conversation.update.mock.calls])).not.toContain(_COMMAND.text);
	});

	it("records retries against the stored ciphertext winner and rolls back a changed-text admission", async function _RetryWinner()
	{
		const f = _Fixture();
		await f.authority.postMessage(_CALLER, "conversation-1", _COMMAND);
		const winner = f.state.payload;
		await f.authority.postMessage(_CALLER, "conversation-1", _COMMAND);
		expect(f.state.payload).toBe(winner);
		expect(f.state.updates).toBe(1);
		expect(f.state.audits).toHaveLength(2);
		expect(f.state.audits[1]).toMatchObject({ argumentsDigest: (f.state.audits[0] as { argumentsDigest: string }).argumentsDigest });
		await expect(f.authority.postMessage(_CALLER, "conversation-1", { ..._COMMAND, text: "Different retry text" })).rejects.toThrow("different text");
		expect(f.state.audits).toHaveLength(2);
		expect(f.state.payload).toBe(winner);
		expect(f.append).toHaveBeenCalledTimes(2);
	});

	it.each(["membership", "participant-or-closed", "grant", "pending-child"])("denies current %s failure without payload, admission or stream writes", async function _Denied(kind)
	{
		const f = _Fixture();
		if (kind === "membership")
			f.client.orgMembership.findUnique.mockResolvedValue({ status: "Suspended", displayName: "Human" });
		if (kind === "participant-or-closed")
			f.client.conversation.findFirst.mockResolvedValue(null);
		if (kind === "grant")
			f.client.authorizationGrant.findMany.mockResolvedValue([]);
		if (kind === "pending-child")
			f.client.conversationChildRequest.findUnique.mockResolvedValue({ siloId: "silo-1", state: "Pending", participantSubjectIds: ["user-1"] });
		await expect(f.authority.postMessage(_CALLER, "conversation-1", _COMMAND)).resolves.toBeNull();
		expect(f.state.payload).toBeNull();
		expect(f.state.audits).toEqual([]);
		expect(f.client.conversationPrivatePayload.create).not.toHaveBeenCalled();
		expect(f.append).not.toHaveBeenCalled();
	});

	it("rolls back evidence and ciphertext when the protected ordering write fails", async function _Rollback()
	{
		const f = _Fixture();
		f.state.failOrdering = true;
		await expect(f.authority.postMessage(_CALLER, "conversation-1", _COMMAND)).rejects.toThrow("ordering transaction failed");
		expect(f.state.payload).toBeNull();
		expect(f.state.audits).toEqual([]);
		expect(f.state.updates).toBe(0);
		expect(f.append).not.toHaveBeenCalled();
	});

	it("retries a proven Serializable rollback through the shared unit-of-work runner", async function _SerializableRetry()
	{
		const f = _Fixture();
		const conflict = new Prisma.PrismaClientKnownRequestError("rolled back", { code: "P2034", clientVersion: "test" });
		f.prisma.$transaction.mockRejectedValueOnce(conflict);

		await expect(f.authority.postMessage(_CALLER, "conversation-1", _COMMAND)).resolves.toMatchObject({ outcome: "accepted" });
		expect(f.prisma.$transaction).toHaveBeenCalledTimes(2);
		expect(f.state.audits).toHaveLength(1);
		expect(f.append).toHaveBeenCalledOnce();
	});

	it("rolls back message writes when attachment authority denies after payload creation", async function _AttachmentDenial()
	{
		const f = _Fixture();
		f.bindOrVerify.mockResolvedValue(null);

		await expect(f.authority.postMessage(_CALLER, "conversation-1", _COMMAND)).resolves.toBeNull();
		expect(f.state.payload).toBeNull();
		expect(f.state.audits).toEqual([]);
		expect(f.state.updates).toBe(0);
		expect(f.append).not.toHaveBeenCalled();
	});

	it("binds canonical attachments in the payload transaction and appends deterministic blocks", async function _AttachmentBlocks()
	{
		const f = _Fixture();
		const command = { ..._COMMAND, assetIds: ["asset-a", "asset-z"] };
		f.bindOrVerify.mockResolvedValue({ attachments: [
			{ assetId: "asset-a", artifactId: "artifact-a", artifactRevisionId: "revision-a", name: "a.pdf", mediaType: "application/pdf" },
			{ assetId: "asset-z", artifactId: "artifact-z", artifactRevisionId: "revision-z", name: "z.pdf", mediaType: "application/pdf" },
		] });

		await expect(f.authority.postMessage(_CALLER, "conversation-1", command)).resolves.toMatchObject({ outcome: "accepted" });
		expect(f.createAttachmentAdmission).toHaveBeenCalledWith(f.client);
		expect(f.bindOrVerify).toHaveBeenCalledWith({ caller: _CALLER, conversationId: "conversation-1", messageId: command.idempotencyKey, canonicalAssetIds: command.assetIds, payloadCreated: true });
		const entry = f.append.mock.calls[0]![0].entry as MessageEntry;
		expect(entry.blocks).toEqual([
			expect.objectContaining({ kind: "text", payloadRef: f.state.payload!.id }),
			{ id: expect.any(String), kind: "artifact", artifactId: "artifact-a", artifactRevisionId: "revision-a", name: "a.pdf", mediaType: "application/pdf" },
			{ id: expect.any(String), kind: "artifact", artifactId: "artifact-z", artifactRevisionId: "revision-z", name: "z.pdf", mediaType: "application/pdf" },
		]);
		expect(new Set(entry.blocks.map(block => block.id)).size).toBe(3);
	});

	it("rejects noncanonical input and malformed attachment metadata without a partial commit", async function _MalformedAttachments()
	{
		const f = _Fixture();
		await expect(f.authority.postMessage(_CALLER, "conversation-1", { ..._COMMAND, assetIds: ["asset-z", "asset-a"] })).rejects.toThrow("canonical order");
		expect(f.prisma.$transaction).not.toHaveBeenCalled();

		f.bindOrVerify.mockResolvedValue({ attachments: [{ assetId: "foreign-asset", artifactId: "artifact-a", artifactRevisionId: "revision-a", name: "a.pdf", mediaType: "application/pdf" }] });
		await expect(f.authority.postMessage(_CALLER, "conversation-1", { ..._COMMAND, assetIds: ["asset-a"] })).rejects.toThrow("does not match");
		expect(f.state.payload).toBeNull();
		expect(f.state.audits).toEqual([]);
		expect(f.append).not.toHaveBeenCalled();
	});

	it("rejects a message UUID already held by another participant before binding", async function _ForeignParticipant()
	{
		const f = _Fixture();
		f.state.payload = { id: "payload-other", siloId: "silo-1", conversationId: "conversation-1", authorSubject: "other-user", idempotencyKey: _COMMAND.idempotencyKey, keyId: "key-1", nonce: Buffer.alloc(12), authTag: Buffer.alloc(16), ciphertext: Buffer.from([1]), ciphertextDigest: `sha256:${"a".repeat(64)}`, createdAt: new Date() };

		await expect(f.authority.postMessage(_CALLER, "conversation-1", _COMMAND)).rejects.toThrow("different participant");
		expect(f.state.audits).toEqual([]);
		expect(f.bindOrVerify).not.toHaveBeenCalled();
		expect(f.append).not.toHaveBeenCalled();
	});

	it("rejects activation that does not match the current conversation mode before admission", async function _Activation()
	{
		const f = _Fixture();
		await expect(f.authority.postMessage(_CALLER, "conversation-1", { ..._COMMAND, activation: ConversationMessageActivations.Start })).rejects.toThrow("cannot activate");
		expect(f.state.audits).toEqual([]);
		expect(f.client.conversationPrivatePayload.create).not.toHaveBeenCalled();
	});

	it.each([ComputerLeaseStates.Released, ComputerLeaseStates.Lost])("Stop keeps the observed generation for a %s lease", async function _StopGeneration(leaseState)
	{
		const f = _Fixture();
		f.client.conversation.findFirst.mockResolvedValue({ mode: ConversationMode.AgentSession, computerId: "computer-1", computerAgentIdentityId: "agent-1", computerProfileRevisionId: "profile-1", participants: [{ visibleFromPosition: 0n }] } as never);
		f.computerReader.load.mockResolvedValue({ computer: { id: "computer-1", leaseGeneration: 7 }, lease: { state: leaseState } });
		f.history.readHead.mockResolvedValue({ streamName: "computer-activations-silo-1", revision: 4n });
		const append = vi.spyOn(ConversationHistoryAuthority.prototype, "appendWithActivation").mockResolvedValue({ outcome: ConversationHistoryAppendOutcomes.Appended } as never);
		await expect(f.authority.postMessage(_CALLER, "conversation-1", { ..._COMMAND, activation: ConversationMessageActivations.Stop })).resolves.toMatchObject({ outcome: "accepted" });
		expect(append).toHaveBeenCalledWith(expect.objectContaining({ entry: expect.objectContaining({ activation: "stop" }), activation: expect.objectContaining({ generation: 7 }) }));
	});

	it.each(["activation", "requester", "participant"])("rejects a recovered history entry with a different %s", async function _ConflictingHistory(field)
	{
		const f = _Fixture();
		await f.authority.postMessage(_CALLER, "conversation-1", _COMMAND);
		const saved = f.append.mock.calls[0]![0].entry as MessageEntry;
		let author = { ...saved.author } as HumanConversationAuthor;
		if (field === "requester")
			author = { ...author, principalId: "other-principal" };
		if (field === "participant")
			author = { ...author, participantId: "other-subject" };
		const activation = field === "activation" ? ConversationMessageActivations.Stop : ConversationMessageActivations.None;
		f.read.mockResolvedValue({ entries: [{ ...saved, author, activation }], streamName: "conversation-conversation-1", genesis: {} } as never);
		await expect(f.authority.postMessage(_CALLER, "conversation-1", _COMMAND)).rejects.toThrow("different command");
		expect(f.append).toHaveBeenCalledOnce();
	});

	it("returns the saved position only when the recovered entry matches every frozen block", async function _RecoveredHistory()
	{
		const f = _Fixture();
		await f.authority.postMessage(_CALLER, "conversation-1", _COMMAND);
		const entry = f.append.mock.calls[0]![0].entry as MessageEntry;
		f.read.mockResolvedValue({ entries: [entry], streamName: "conversation-conversation-1", genesis: {} } as never);

		await expect(f.authority.postMessage(_CALLER, "conversation-1", _COMMAND)).resolves.toEqual({ outcome: "idempotent", position: "1" });
		expect(f.bindOrVerify).toHaveBeenLastCalledWith(expect.objectContaining({ payloadCreated: false }));
		expect(f.append).toHaveBeenCalledOnce();
		f.read.mockResolvedValue({ entries: [{ ...entry, blocks: [{ ...entry.blocks[0], ciphertextDigest: "sha256:changed" }] }], streamName: "conversation-conversation-1", genesis: {} } as never);
		await expect(f.authority.postMessage(_CALLER, "conversation-1", _COMMAND)).rejects.toThrow("different command");
		expect(f.append).toHaveBeenCalledOnce();
	});

});
