import { randomUUID } from "node:crypto";

import { PrismaClient, type ConversationPrivatePayload } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { PrismaConversationComputerTurnUnitOfWork, type FrozenConversationComputerTurn } from "@opencrane/backend/server/conversations";
import { AesGcmConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";
import { ___IsRolledBackConflict } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { _SeedConversationToolProposalSqlFixture } from "./conversation-tool-proposal.sql-fixture";

/** Close every independent client without deleting the fixture's immutable rows. */
const _clients = new Set<PrismaClient>();
/** Use synthetic encryption material that is unrelated to any deployment key. */
const _cipher = AesGcmConversationPrivatePayloadCipher.fromDocument({ currentKeyId: "output-sql-key", keys: { "output-sql-key": Buffer.alloc(32, 19).toString("base64url") } });
/** Make accidental plaintext persistence recognizable in both text and display rows. */
const _text = "Private inventory answer: Nairobi has 172 items.";
/** Supply the serialized static display that the output store receives after validation. */
const _display = JSON.stringify([
	{ surfaceUpdate: { surfaceId: "conversation-result", components: [{ id: "summary", component: { Text: { text: { literalString: "Private inventory: 172 items" } } } }] } },
	{ beginRendering: { surfaceId: "conversation-result", root: "summary" } },
]);

/** Allocate a separate connection pool, including for recovery after a committed write. */
function _client(): PrismaClient
{
	const client = new PrismaClient();
	_clients.add(client);
	return client;
}

/** Exercise the real transaction owner without granting access to history or run admission. */
function _store(client: PrismaClient): PrismaConversationComputerTurnUnitOfWork
{
	return new PrismaConversationComputerTurnUnitOfWork(client,
		{ readStream: function _NoHistory(): never { throw new Error("Output SQL proof must not access history"); } },
		_cipher, 75_000,
		{ admit: function _NoAdmission(): never { throw new Error("Output SQL proof must not admit runs"); } });
}

/** Read committed rows and retain PostgreSQL's full timestamp precision for retry comparisons. */
async function _state(client: PrismaClient, turn: FrozenConversationComputerTurn)
{
	const rows = await client.conversationPrivatePayload.findMany({ where: { conversationId: turn.binding.conversationId }, orderBy: { id: "asc" } });
	const timestamps = await client.$queryRaw<Array<{ updated_at: string }>>`SELECT updated_at::text FROM conversations WHERE id = ${turn.binding.conversationId} AND silo_id = ${turn.siloId}`;
	expect(timestamps).toHaveLength(1);
	return { rows, updatedAt: timestamps[0]!.updated_at };
}

/** Authenticate saved ciphertext against the row's own ownership coordinates. */
function _decrypt(row: ConversationPrivatePayload): string
{
	return _cipher.decrypt(row, { siloId: row.siloId, conversationId: row.conversationId, authorSubject: row.authorSubject, payloadRef: row.id });
}

/** Verify the complete committed result without reproducing the production event-ID algorithm. */
async function _expectOutput(client: PrismaClient, turn: FrozenConversationComputerTurn, command: string, result: Awaited<ReturnType<PrismaConversationComputerTurnUnitOfWork["store"]>>, display: string | null)
{
	const state = await _state(client, turn);
	expect(state.rows).toHaveLength(display === null ? 2 : 3);
	const primary = state.rows.find(row => row.id === result.payloadRef)!;
	expect(primary).toMatchObject({ idempotencyKey: command, ciphertextDigest: result.ciphertextDigest });
	expect(_decrypt(primary)).toBe(_text);
	expect(result.blockId).toEqual(expect.any(String));
	if (display === null)
		expect(result.display).toBeNull();
	else
	{
		expect(result.display).not.toBeNull();
		const structured = state.rows.find(row => row.id === result.display!.payloadRef)!;
		expect(structured.ciphertextDigest).toBe(result.display!.ciphertextDigest);
		expect(_decrypt(structured)).toBe(display);
	}
	const manifests = state.rows.filter(row => row.id !== result.payloadRef && row.id !== result.display?.payloadRef);
	expect(manifests).toHaveLength(1);
	expect(JSON.parse(_decrypt(manifests[0]!))).toEqual({ textDigest: ___DigestCanonicalJson(_text), displayDigest: display === null ? null : ___DigestCanonicalJson(display) });
	expect(new Set(state.rows.map(row => row.idempotencyKey)).size).toBe(state.rows.length);
	expect(new Set(state.rows.map(row => Buffer.from(row.nonce).toString("hex"))).size).toBe(state.rows.length);
	for (const row of state.rows)
	{
		expect(row).toMatchObject({ siloId: turn.siloId, conversationId: turn.binding.conversationId, authorSubject: turn.binding.agentIdentityId, keyId: "output-sql-key" });
		expect(row.nonce).toHaveLength(12);
		expect(row.authTag).toHaveLength(16);
		expect(row.ciphertext).toHaveLength(Buffer.byteLength(_decrypt(row), "utf8"));
		expect(Buffer.from(row.ciphertext).toString("utf8")).not.toContain("Private inventory");
		expect(JSON.stringify(row)).not.toContain("Private inventory");
	}
	return state;
}

describe("conversation output custody on real PostgreSQL", function _Suite()
{
	beforeAll(function _RequireDatabase()
	{
		if (!process.env.DATABASE_URL)
			throw new Error("Output payload SQL proof requires DATABASE_URL and the reviewed target baseline");
	});
	afterEach(async function _Disconnect()
	{
		await Promise.all(Array.from(_clients, client => client.$disconnect()));
		_clients.clear();
	});

	it("commits an encrypted digest manifest, text and display together", async function _CompleteOutput()
	{
		const { frozenTurn: turn } = await _SeedConversationToolProposalSqlFixture();
		const command = randomUUID();
		const observer = _client();
		const before = await _state(observer, turn);
		expect(before.rows).toEqual([]);
		const result = await _store(_client()).store(turn, command, _text, _display);
		const saved = await _expectOutput(observer, turn, command, result, _display);
		expect(saved.updatedAt).not.toBe(before.updatedAt);
	});

	it("records an absent display explicitly when the optional argument is omitted", async function _AbsentDisplay()
	{
		const { frozenTurn: turn } = await _SeedConversationToolProposalSqlFixture();
		const command = randomUUID();
		const result = await _store(_client()).store(turn, command, _text);
		await _expectOutput(_client(), turn, command, result, null);
	});

	it.each([null, _display])("preserves ciphertext and timestamp after a new-client retry with display %s", async function _Restart(display)
	{
		const { frozenTurn: turn } = await _SeedConversationToolProposalSqlFixture();
		const command = randomUUID();
		const originalClient = _client();
		const original = await _store(originalClient).store(turn, command, _text, display);
		const saved = await _expectOutput(originalClient, turn, command, original, display);
		await originalClient.$disconnect();
		const restartedClient = _client();
		await expect(_store(restartedClient).store(turn, command, _text, display)).resolves.toEqual(original);
		expect(await _state(restartedClient, turn)).toEqual(saved);
	});

	it.each([
		["changed text", _display, "Private inventory changed answer", _display],
		["changed display", _display, _text, _display.replace("172", "173")],
		["added display", null, _text, _display],
		["removed display", _display, _text, null],
	] as const)("rejects %s without changing committed rows or timestamp", async function _ChangedOutput(_name, display, retryText, retryDisplay)
	{
		const { frozenTurn: turn } = await _SeedConversationToolProposalSqlFixture();
		const command = randomUUID();
		const original = await _store(_client()).store(turn, command, _text, display);
		const observer = _client();
		const saved = await _expectOutput(observer, turn, command, original, display);
		await expect(_store(_client()).store(turn, command, retryText, retryDisplay)).rejects.toThrow("idempotency key was reused for different output");
		expect(await _state(observer, turn)).toEqual(saved);
		await expect(_store(observer).store(turn, command, _text, display)).resolves.toEqual(original);
		expect(await _state(observer, turn)).toEqual(saved);
	});

	it("rolls back earlier payloads and timestamp when the third payload exceeds the cipher limit", async function _Rollback()
	{
		const { frozenTurn: turn } = await _SeedConversationToolProposalSqlFixture();
		const command = randomUUID();
		const observer = _client();
		const before = await _state(observer, turn);
		expect(before.rows).toEqual([]);
		await expect(_store(_client()).store(turn, command, _text, "x".repeat(65_537))).rejects.toThrow("at most 65536 UTF-8 bytes");
		expect(await _state(observer, turn)).toEqual(before);
		const result = await _store(_client()).store(turn, command, _text, _display);
		const saved = await _expectOutput(observer, turn, command, result, _display);
		expect(saved.updatedAt).not.toBe(before.updatedAt);
		await expect(_store(_client()).store(turn, command, _text, _display)).resolves.toEqual(result);
		expect(await _state(observer, turn)).toEqual(saved);
	});

	it("adopts the same committed complete output after concurrent identical writers", async function _ConcurrentOutput()
	{
		const { frozenTurn: turn } = await _SeedConversationToolProposalSqlFixture();
		const command = randomUUID();
		const writers = [_store(_client()), _store(_client())];
		const results = await Promise.allSettled(writers.map(writer => writer.store(turn, command, _text, _display)));
		for (const result of results)
		{
			if (result.status === "rejected" && !___IsRolledBackConflict(result.reason))
				throw result.reason;
		}
		// Concurrent starts can both succeed, or PostgreSQL can roll one transaction back.
		const successes = results.filter(result => result.status === "fulfilled");
		expect(successes.length).toBeGreaterThanOrEqual(1);
		const original = successes[0]!.value;
		for (const result of successes)
			expect(result.value).toEqual(original);
		const observer = _client();
		const saved = await _expectOutput(observer, turn, command, original, _display);
		for (const writer of writers)
		{
			await expect(writer.store(turn, command, _text, _display)).resolves.toEqual(original);
			expect(await _state(observer, turn)).toEqual(saved);
		}
	});
});
