import { Prisma, type ConversationPrivatePayload } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ___CanonicalizeJson, ___DigestCanonicalJson } from "@opencrane/util";
import { AesGcmConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";
import type { FrozenConversationComputerTurn } from "../../conversation-computer-turn.types";
import { _ConversationComputerEventId } from "../../../conversation-computer-event-id";
import { PrismaConversationComputerTurnUnitOfWork } from "../prisma-conversation-computer-turn-unit-of-work";

/** Supply the already-admitted coordinates read by output storage, not an admission fixture. */
const _TURN = { siloId: "silo-1", binding: { conversationId: "conversation-1", agentIdentityId: "identity-1" } } as FrozenConversationComputerTurn;
/** Keep the source command constant across crash/retry cases. */
const _COMMAND = "command-1";
/** Give the answer recognizable private bytes for ciphertext assertions. */
const _TEXT = "Private answer: inventory total is 172.";
/** Represent an already-validated display as the exact serialized string the store receives. */
const _DISPLAY = JSON.stringify({ title: "Private inventory", rows: [{ label: "Nairobi", count: 172 }] });

/**
 * Exercise the concrete repository and cipher with transaction-scoped delegates.
 * The adapter commits a copied row set only when the callback succeeds. It models rollback
 * and records list-order updates; it does not execute PostgreSQL or its timestamp trigger.
 */
function _fixture()
{
	const rows = new Map<string, ConversationPrivatePayload>();
	let activeRows = rows;
	let pendingUpdates = 0;
	let committedUpdates = 0;
	const controls = { rejectSource: null as string | null, rejectUpdate: 0 };
	const operations: string[] = [];
	const payload = {
		findUnique: vi.fn(async function _Find({ where }: { where: Prisma.ConversationPrivatePayloadWhereUniqueInput })
		{
			const key = where.conversationId_authorSubject_idempotencyKey!;
			operations.push(`find:${key.idempotencyKey}`);
			return Array.from(activeRows.values()).find(row => row.conversationId === key.conversationId && row.authorSubject === key.authorSubject && row.idempotencyKey === key.idempotencyKey) ?? null;
		}),
		create: vi.fn(async function _Create({ data }: { data: Omit<ConversationPrivatePayload, "createdAt"> })
		{
			operations.push(`create:${data.idempotencyKey}`);
			if (data.idempotencyKey === controls.rejectSource)
				throw new Error("Injected payload failure");
			if (activeRows.has(data.id))
				throw new Error("Duplicate payload identifier");
			const row = { ...data, createdAt: new Date() };
			activeRows.set(row.id, row);
			return row;
		}),
	};
	const conversation = { update: vi.fn(async function _Update()
	{
		operations.push("update-conversation");
		pendingUpdates += 1;
		if (pendingUpdates === controls.rejectUpdate)
			throw new Error("Injected conversation update failure");
		return { id: _TURN.binding.conversationId };
	}) };
	const transaction = { conversationPrivatePayload: payload, conversation };
	const forbidden = vi.fn(function _RootDelegate() { throw new Error("Output storage must use transaction delegates"); });
	const prisma = {
		conversationPrivatePayload: { findUnique: forbidden, create: forbidden },
		conversation: { update: forbidden },
		$transaction: vi.fn(async function _Transaction(operation: (client: Prisma.TransactionClient) => Promise<unknown>)
		{
			activeRows = new Map(rows);
			pendingUpdates = 0;
			try
			{
				const result = await operation(transaction as unknown as Prisma.TransactionClient);
				rows.clear();
				for (const [id, row] of activeRows)
					rows.set(id, row);
				committedUpdates += pendingUpdates;
				return result;
			}
			finally
			{
				activeRows = rows;
			}
		}),
	};
	const history = { readStream: vi.fn(async function* _History() { throw new Error("Custody does not write or read history"); }) };
	const cipher = new AesGcmConversationPrivatePayloadCipher("test-key", { "test-key": Buffer.alloc(32, 7).toString("base64url") });
	const admission = { admit: vi.fn().mockRejectedValue(new Error("Custody does not admit a run")) };
	const store = new PrismaConversationComputerTurnUnitOfWork(prisma as never, history, cipher, 75_000, admission);
	return { rows, payload, conversation, controls, operations, prisma, forbidden, history, cipher, store, committedUpdates: function _Updates() { return committedUpdates; } };
}

/** Decrypt a saved row using the same ownership coordinates as the production reader. */
function _decrypt(fixture: ReturnType<typeof _fixture>, row: ConversationPrivatePayload): string
{
	return fixture.cipher.decrypt(row, { siloId: row.siloId, conversationId: row.conversationId, authorSubject: row.authorSubject, payloadRef: row.id });
}

describe("conversation output encrypted custody", function _OutputCustody()
{
	it("stores an encrypted digest manifest, answer and display in one serializable transaction", async function _CompleteOutput()
	{
		const fixture = _fixture();
		const result = await fixture.store.store(_TURN, _COMMAND, _TEXT, _DISPLAY);
		const manifestKey = _ConversationComputerEventId("output-shape", _COMMAND);
		const displayKey = _ConversationComputerEventId("structured-output", _COMMAND);
		const manifest = fixture.rows.get(_ConversationComputerEventId("payload", manifestKey))!;
		const primary = fixture.rows.get(_ConversationComputerEventId("payload", _COMMAND))!;
		const display = fixture.rows.get(_ConversationComputerEventId("payload", displayKey))!;
		expect(fixture.rows.size).toBe(3);
		expect(result).toEqual({ blockId: _ConversationComputerEventId("block", _COMMAND), payloadRef: primary.id, ciphertextDigest: primary.ciphertextDigest, display: { payloadRef: display.id, ciphertextDigest: display.ciphertextDigest } });
		expect(_decrypt(fixture, manifest)).toBe(___CanonicalizeJson({ textDigest: ___DigestCanonicalJson(_TEXT), displayDigest: ___DigestCanonicalJson(_DISPLAY) }));
		expect(_decrypt(fixture, primary)).toBe(_TEXT);
		expect(_decrypt(fixture, display)).toBe(_DISPLAY);
		for (const row of fixture.rows.values())
		{
			expect(Object.keys(row).sort()).toEqual(["id", "siloId", "conversationId", "authorSubject", "idempotencyKey", "keyId", "nonce", "authTag", "ciphertext", "ciphertextDigest", "createdAt"].sort());
			expect(row).toMatchObject({ siloId: _TURN.siloId, conversationId: _TURN.binding.conversationId, authorSubject: _TURN.binding.agentIdentityId });
			expect(Buffer.from(row.ciphertext).toString("utf8")).not.toContain("Private");
			expect(JSON.stringify(row)).not.toContain("Private");
		}
		expect(fixture.operations).toEqual([`find:${manifestKey}`, `create:${manifestKey}`, "update-conversation", `find:${_COMMAND}`, `create:${_COMMAND}`, "update-conversation", `find:${displayKey}`, `create:${displayKey}`, "update-conversation"]);
		expect(fixture.prisma.$transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
		expect(fixture.conversation.update).toHaveBeenCalledWith({ where: { id_siloId: { id: _TURN.binding.conversationId, siloId: _TURN.siloId } }, data: { updatedAt: expect.any(Date) }, select: { id: true } });
		expect(fixture.committedUpdates()).toBe(3);
		expect(fixture.forbidden).not.toHaveBeenCalled();
		expect(fixture.history.readStream).not.toHaveBeenCalled();
	});

	it("records an absent display explicitly while preserving the primary text identifiers", async function _TextOnly()
	{
		const fixture = _fixture();
		const result = await fixture.store.store(_TURN, _COMMAND, _TEXT);
		expect(result).toMatchObject({ blockId: _ConversationComputerEventId("block", _COMMAND), payloadRef: _ConversationComputerEventId("payload", _COMMAND), display: null });
		expect(fixture.rows.size).toBe(2);
		const manifest = fixture.rows.get(_ConversationComputerEventId("payload", _ConversationComputerEventId("output-shape", _COMMAND)))!;
		expect(JSON.parse(_decrypt(fixture, manifest))).toEqual({ textDigest: ___DigestCanonicalJson(_TEXT), displayDigest: null });
	});

	it.each([null, _DISPLAY])("returns identical ciphertext on a restarted retry with display %s", async function _Retry(display)
	{
		const fixture = _fixture();
		const result = await fixture.store.store(_TURN, _COMMAND, _TEXT, display);
		const savedRows = Array.from(fixture.rows.values());
		const updated = fixture.committedUpdates();
		fixture.payload.create.mockClear();
		fixture.conversation.update.mockClear();
		const restarted = new PrismaConversationComputerTurnUnitOfWork(fixture.prisma as never, fixture.history, fixture.cipher, 75_000, { admit: vi.fn() });
		await expect(restarted.store(_TURN, _COMMAND, _TEXT, display)).resolves.toEqual(result);
		expect(Array.from(fixture.rows.values())).toEqual(savedRows);
		expect(fixture.committedUpdates()).toBe(updated);
		expect(fixture.payload.create).not.toHaveBeenCalled();
		expect(fixture.conversation.update).not.toHaveBeenCalled();
	});

	it.each([
		["changed text", _TEXT, _DISPLAY, "Different answer", _DISPLAY],
		["changed display", _TEXT, _DISPLAY, _TEXT, "Different display"],
		["added display", _TEXT, null, _TEXT, _DISPLAY],
		["removed display", _TEXT, _DISPLAY, _TEXT, null],
	] as const)("refuses %s before reading or writing either participant-facing payload", async function _ChangedOutput(_name, text, display, retryText, retryDisplay)
	{
		const fixture = _fixture();
		await fixture.store.store(_TURN, _COMMAND, text, display);
		const savedRows = Array.from(fixture.rows.values());
		fixture.payload.findUnique.mockClear();
		fixture.payload.create.mockClear();
		fixture.conversation.update.mockClear();
		await expect(fixture.store.store(_TURN, _COMMAND, retryText, retryDisplay)).rejects.toThrow("different output");
		expect(fixture.payload.findUnique).toHaveBeenCalledTimes(1);
		expect(fixture.payload.create).not.toHaveBeenCalled();
		expect(fixture.conversation.update).not.toHaveBeenCalled();
		expect(Array.from(fixture.rows.values())).toEqual(savedRows);
	});

	it.each(["payload", "conversation update", "encryption"])("rolls back the complete result after a later %s failure", async function _Rollback(failure)
	{
		const fixture = _fixture();
		if (failure === "payload")
			fixture.controls.rejectSource = _ConversationComputerEventId("structured-output", _COMMAND);
		if (failure === "conversation update")
			fixture.controls.rejectUpdate = 3;
		const display = failure === "encryption" ? "x".repeat(65_537) : _DISPLAY;
		await expect(fixture.store.store(_TURN, _COMMAND, _TEXT, display)).rejects.toThrow();
		expect(fixture.payload.create.mock.calls.length).toBeGreaterThanOrEqual(2);
		expect(fixture.rows.size).toBe(0);
		expect(fixture.committedUpdates()).toBe(0);
		expect(fixture.prisma.$transaction).toHaveBeenCalledTimes(1);
		fixture.controls.rejectSource = null;
		fixture.controls.rejectUpdate = 0;
		await expect(fixture.store.store(_TURN, _COMMAND, _TEXT, _DISPLAY)).resolves.toMatchObject({ display: { payloadRef: expect.any(String) } });
		expect(fixture.rows.size).toBe(3);
	});
});
