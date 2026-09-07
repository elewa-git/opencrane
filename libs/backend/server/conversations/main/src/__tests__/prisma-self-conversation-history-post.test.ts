import { ConversationMode, Prisma, type ConversationPrivatePayload } from "@prisma/client";
import { ProductAuthorizationActions } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationHistoryAuthority } from "../conversation-history-authority";
import { ConversationHistoryAppendOutcomes } from "../conversation-history-authority.types";
import { ConversationHistoryReader } from "../conversation-history-reader";
import { AesGcmConversationPrivatePayloadCipher } from "../conversation-private-payload-cipher";
import { PrismaSelfConversationHistoryUnitOfWork } from "../prisma-self-conversation-history";
import { ConversationMessageActivations } from "../self-conversation-history.types";
import { _ConversationAuthorizationFixture } from "./conversation-authorization.fixtures";

const _CALLER = { principalId: "principal-1", subjectId: "user-1", siloId: "silo-1", externalIssuer: "https://issuer.test", verifiedAuthenticationAt: "2026-09-08T00:00:00.000Z" };
const _COMMAND = { idempotencyKey: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", activation: ConversationMessageActivations.None, text: "Private message text must stay outside SQL" };

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
		conversationPrivatePayload: { findUnique: vi.fn(), create: vi.fn() },
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
		client.conversationPrivatePayload.findUnique.mockImplementation(async function _Read() { return payload; });
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
	const authority = new PrismaSelfConversationHistoryUnitOfWork(prisma as never, history, { cipher, computerReader: { load: vi.fn() } }, new ConversationHistoryAuthority(history));
	return { authority, client, state, events, prisma, read, append };
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
		expect(f.state.audits[0]).toMatchObject({ action: ProductAuthorizationActions.Use, argumentsDigest: ___DigestCanonicalJson({ payloadRef: f.state.payload!.id, ciphertextDigest: f.state.payload!.ciphertextDigest, idempotencyKey: _COMMAND.idempotencyKey, activation: _COMMAND.activation }) });
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

	it("rejects activation that does not match the current conversation mode before admission", async function _Activation()
	{
		const f = _Fixture();
		await expect(f.authority.postMessage(_CALLER, "conversation-1", { ..._COMMAND, activation: ConversationMessageActivations.Start })).rejects.toThrow("cannot activate");
		expect(f.state.audits).toEqual([]);
		expect(f.client.conversationPrivatePayload.create).not.toHaveBeenCalled();
	});
});
