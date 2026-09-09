import type { PrismaClient } from "@prisma/client";
import type { ConversationEntry } from "@opencrane/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationHistoryAuthority } from "@opencrane/backend/server/conversations/history";
import { ConversationHistoryReader } from "@opencrane/backend/server/conversations/history";
import { PrismaConversationHistoryRepository } from "../db/prisma-conversation-history-repository";
import { PrismaSelfConversationHistoryUnitOfWork } from "../prisma-self-conversation-history";

const _CALLER = { siloId: "silo-1", subjectId: "subject-1", principalId: "principal-1" };

function _Harness()
{
	const projection = { authorName: "Participant", mode: "Direct", computerId: null, computerAgentIdentityId: null, computerProfileRevisionId: null, visibleFromPosition: 0n } as const;
	const authorize = vi.spyOn(PrismaConversationHistoryRepository.prototype, "authorizeRead").mockResolvedValue(projection as never);
	const payloads = vi.spyOn(PrismaConversationHistoryRepository.prototype, "readPayloads").mockResolvedValue([]);
	const read = vi.spyOn(ConversationHistoryReader.prototype, "read").mockResolvedValue({ entries: [], streamName: "conversation-conversation-1", genesis: {} as never });
	const prisma = { $transaction: vi.fn(async function _Transaction(work) { return work({}); }) } as unknown as PrismaClient;
	const history = { readStream: vi.fn(), readHead: vi.fn(), append: vi.fn(), appendAtomic: vi.fn() };
	const cipher = { encrypt: vi.fn(), decrypt: vi.fn() };
	const computerReader = { load: vi.fn() };
	const authority = new PrismaSelfConversationHistoryUnitOfWork(prisma, history, { cipher, computerReader }, new ConversationHistoryAuthority(history));
	const options = { maxCount: 1, maximumBytes: 4096, signal: new AbortController().signal };
	return { authority, authorize, payloads, read, cipher, computerReader, options, projection };
}

afterEach(function _Restore() { vi.restoreAllMocks(); });

describe("bounded participant history authority", function ()
{
	it("excludes pre-join private references from both finite history and browser event pages", async function ()
	{
		for (const bounded of [false, true])
		{
			const harness = _Harness();
			harness.authorize.mockResolvedValue({ ...harness.projection, visibleFromPosition: 5n });
			const beforeJoin = { position: "1", visibility: { audience: "conversation" }, kind: "a2ui", payloadRef: "private-before-join" } as unknown as ConversationEntry;
			const afterJoin = { position: "5", visibility: { audience: "conversation" }, kind: "a2ui", payloadRef: null } as unknown as ConversationEntry;
			harness.read.mockResolvedValue({ entries: [beforeJoin, afterJoin], streamName: "conversation-conversation-1", genesis: {} as never });
			const result = await harness.authority.read(_CALLER, "conversation-1", 0n, bounded ? harness.options : undefined);
			expect(harness.read).toHaveBeenCalledWith(expect.objectContaining({ fromRevision: 5n }));
			expect(result?.entries).toEqual([afterJoin]);
			expect(harness.payloads).toHaveBeenCalledWith(_CALLER, "conversation-1", []);
			expect(harness.cipher.decrypt).not.toHaveBeenCalled();
			vi.restoreAllMocks();
		}
	});

	it("rechecks the join boundary before loading any private payload", async function ()
	{
		const harness = _Harness();
		harness.authorize.mockResolvedValueOnce(harness.projection).mockResolvedValueOnce({ ...harness.projection, visibleFromPosition: 5n });
		const entry = { position: "1", visibility: { audience: "conversation" }, kind: "a2ui", payloadRef: "private-before-rejoin" } as unknown as ConversationEntry;
		harness.read.mockResolvedValue({ entries: [entry], streamName: "conversation-conversation-1", genesis: {} as never });
		expect((await harness.authority.read(_CALLER, "conversation-1", 0n, harness.options))?.entries).toEqual([]);
		expect(harness.payloads).toHaveBeenCalledWith(_CALLER, "conversation-1", []);
		expect(harness.cipher.decrypt).not.toHaveBeenCalled();
	});

	it("ends a read when participant authority is revoked before plaintext loading", async function ()
	{
		const harness = _Harness();
		harness.authorize.mockResolvedValueOnce({} as never).mockResolvedValueOnce(null);
		expect(await harness.authority.read(_CALLER, "conversation-1", 0n, harness.options)).toBeNull();
		expect(harness.authorize).toHaveBeenCalledTimes(2);
		expect(harness.payloads).not.toHaveBeenCalled();
		expect(harness.cipher.decrypt).not.toHaveBeenCalled();
	});

	it("advances the bounded cursor over entries hidden from this participant without decrypting them", async function ()
	{
		const harness = _Harness();
		const hidden = { position: "7", visibility: { audience: "participants", participantIds: ["other"] } } as unknown as ConversationEntry;
		harness.read.mockResolvedValue({ entries: [hidden], streamName: "conversation-conversation-1", genesis: {} as never });
		expect(await harness.authority.read(_CALLER, "conversation-1", 6n, harness.options)).toEqual({ entries: [], payloads: {}, nextPosition: "7", computer: null });
		expect(harness.payloads).toHaveBeenCalledWith(_CALLER, "conversation-1", []);
		expect(harness.computerReader.load).not.toHaveBeenCalled();
	});

	it("cannot start Kurrent reads after cancellation during the first permission check", async function ()
	{
		const harness = _Harness();
		const stop = new AbortController();
		harness.authorize.mockImplementationOnce(async function _RevokeDuringRead() { stop.abort(); return {} as never; });
		await expect(harness.authority.read(_CALLER, "conversation-1", 0n, { ...harness.options, signal: stop.signal })).rejects.toThrow();
		expect(harness.read).not.toHaveBeenCalled();
	});
});
