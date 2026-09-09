import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationModelToolModes } from "@opencrane/contracts";
import { ___CanonicalizeJson } from "@opencrane/util";

import { AesGcmConversationPrivatePayloadCipher } from "../conversation-private-payload-cipher";
import type { ConversationComputerToolContinuation, ConversationComputerToolDeclaration } from "../conversation-computer-continuation.types";
import type { FrozenConversationComputerTurn } from "../conversation-computer-turn.types";
import { PrismaConversationModelCustodyUnitOfWork } from "../db/prisma-conversation-model-custody";

const _NOW = Date.parse("2026-09-09T00:00:00.000Z");
const _DIGEST = `sha256:${"a".repeat(64)}`;
const _TURN = {
	bootstrapId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", siloId: "silo-1", computerId: "computer-1",
	lease: { leaseId: "lease-1", leaseGeneration: 1, sandboxClaimId: "computer-1-g1" },
	latestPendingEntryId: "entry-1", modelAlias: "model-1", maximumBudgetUsd: 0.05, credentialLifetimeSeconds: 300,
	outputSourceCommandId: null, outputReceipt: null, toolSelection: null, continuationReservation: null,
	binding: { siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", leaseGeneration: 1, agentIdentityId: "identity-1", agentServiceId: "service-1", agentName: "Ada", agentAvatarArtifactRevisionId: null, runId: "run-1", expectedRevision: 1n, maximumEntryBytes: 65_536 },
	compile: { runId: "run-1", attempt: 1, promptCompilerVersion: "computer-v1", digest: _DIGEST },
	modelReservation: { invocationFence: "784aec47-a8ce-42e7-8643-7cce098812eb", ordinal: 1, tools: ConversationModelToolModes.Select, compiledInputDigest: _DIGEST, requestDigest: _DIGEST, maxCompletionTokens: 100, authorityExpiresAtEpochMs: _NOW + 300_000, dispatchDeadlineEpochMs: _NOW + 25_000 },
} satisfies FrozenConversationComputerTurn;
const _DECLARATION: ConversationComputerToolDeclaration = {
	bootstrapId: _TURN.bootstrapId, runId: _TURN.compile.runId, attempt: 1, compiledInputDigest: _DIGEST, modelInvocationFence: _TURN.modelReservation.invocationFence,
	acceptedAtEpochMs: _NOW - 1, requestNotAfterEpochMs: _NOW + 20_000, credentialDigest: _DIGEST, credentialExpiresAt: new Date(_NOW + 300_000).toISOString(),
	call: { id: "call_original", name: "lookup_order", arguments: "{ \"order\": \"private-order-42\" }", content: "Private assistant declaration" },
};

beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(_NOW); });
afterEach(() => { vi.restoreAllMocks(); });

/** Keeps committed ciphertext across new unit-of-work instances without supplying a history writer. */
function _Fixture()
{
	const rows = new Map<string, Record<string, any>>();
	const payload = {
		findUnique: vi.fn(async ({ where }) => rows.get(where.id) ?? null),
		create: vi.fn(async ({ data }) =>
		{
			if (rows.has(data.id))
				throw new Error("unique payload conflict");
			rows.set(data.id, data);
			return data;
		}),
	};
	const forbidden = vi.fn(() => { throw new Error("Custody must not write messages or events"); });
	const transaction = { conversationPrivatePayload: payload, conversationMessage: { create: forbidden }, conversationEvent: { create: forbidden }, toolInvocation: { create: forbidden } };
	const prisma = { $transaction: vi.fn(async (operation) => await operation(transaction)) };
	const cipher = new AesGcmConversationPrivatePayloadCipher("key-1", { "key-1": randomBytes(32).toString("base64url") });
	const custody = new PrismaConversationModelCustodyUnitOfWork(prisma as never, cipher);
	return { rows, payload, forbidden, prisma, cipher, custody };
}

/** Builds the selected turn and assistant/tool pair from the declaration's actual encrypted reference. */
async function _Selected(f: ReturnType<typeof _Fixture>)
{
	const declaration = await f.custody.storeDeclaration(_TURN, _DECLARATION);
	const proposalId = "61c1f1dc-0010-4f13-9c2f-d3841ffd6651";
	const turn: FrozenConversationComputerTurn = { ..._TURN, toolSelection: { ...declaration, proposalId, requestFingerprint: _DIGEST } };
	const continuation: ConversationComputerToolContinuation = { bootstrapId: turn.bootstrapId, runId: turn.compile.runId, attempt: 1, compiledInputDigest: _DIGEST, declaration, proposalId, resultDigest: _DIGEST, call: _DECLARATION.call, resultContent: "{\"order\":\"private-result-42\"}" };
	return { turn, continuation };
}

describe("conversation model encrypted custody", function _ModelCustody()
{
	it("stores encrypted declaration bytes and ownership metadata without a participant or tool write", async function _PrivateStorage()
	{
		const f = _Fixture();
		const reference = await f.custody.storeDeclaration(_TURN, _DECLARATION);
		const row = f.rows.get(reference.payloadRef)!;
		expect(reference).toEqual({ payloadRef: row.id, ciphertextDigest: row.ciphertextDigest });
		expect(Object.keys(row).sort()).toEqual(["id", "siloId", "conversationId", "authorSubject", "idempotencyKey", "keyId", "nonce", "authTag", "ciphertext", "ciphertextDigest"].sort());
		expect(row).toMatchObject({ siloId: "silo-1", conversationId: "conversation-1", authorSubject: "identity-1", idempotencyKey: row.id });
		expect(Buffer.from(row.ciphertext).toString("utf8")).not.toContain("private-order-42");
		expect(f.cipher.decrypt(row as never, { siloId: row.siloId, conversationId: row.conversationId, authorSubject: row.authorSubject, payloadRef: row.id })).toBe(___CanonicalizeJson({ ..._DECLARATION, call: { ..._DECLARATION.call } }));
		expect(await f.custody.loadDeclaration(_TURN)).toEqual({ declaration: _DECLARATION, reference });
		expect(f.prisma.$transaction).toHaveBeenLastCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "Serializable" }));
		expect(f.forbidden).not.toHaveBeenCalled();
	});

	it("recovers after custody commits but the later turn event fails, even after response acceptance expires", async function _LostTurnEvent()
	{
		const f = _Fixture();
		const reference = await f.custody.storeDeclaration(_TURN, _DECLARATION);
		const appendTurnEvent = vi.fn().mockRejectedValue(new Error("process lost before tool selection"));
		await expect(appendTurnEvent(reference)).rejects.toThrow("process lost");
		vi.mocked(Date.now).mockReturnValue(_NOW + 40_000);
		const restarted = new PrismaConversationModelCustodyUnitOfWork(f.prisma as never, f.cipher);
		expect(_TURN.toolSelection).toBeNull();
		await expect(restarted.loadDeclaration(_TURN)).resolves.toEqual({ declaration: _DECLARATION, reference });
		await expect(restarted.storeDeclaration(_TURN, _DECLARATION)).resolves.toEqual(reference);
		expect(f.payload.create).toHaveBeenCalledTimes(1);
		expect(f.forbidden).not.toHaveBeenCalled();
	});

	it("refuses to replace an accepted declaration with changed arguments", async function _CannotReplace()
	{
		const f = _Fixture();
		await f.custody.storeDeclaration(_TURN, _DECLARATION);
		await expect(f.custody.storeDeclaration(_TURN, { ..._DECLARATION, call: { ..._DECLARATION.call, arguments: "{}" } })).rejects.toThrow("cannot replace saved content");
		expect(f.payload.create).toHaveBeenCalledTimes(1);
	});

	it.each(["siloId", "conversationId", "authorSubject", "idempotencyKey"])("rejects a row whose %s coordinate changed", async function _RowCoordinates(field)
	{
		const f = _Fixture();
		const reference = await f.custody.storeDeclaration(_TURN, _DECLARATION);
		f.rows.get(reference.payloadRef)![field] = "foreign-coordinate";
		await expect(f.custody.loadDeclaration(_TURN)).rejects.toThrow("crossed its original coordinates");
	});

	it.each(["silo", "conversation", "author"])("rejects a saved declaration loaded under a different %s", async function _TurnCoordinates(field)
	{
		const f = _Fixture();
		await f.custody.storeDeclaration(_TURN, _DECLARATION);
		const turn = { ..._TURN, binding: { ..._TURN.binding } };
		if (field === "silo")
			turn.siloId = "foreign-silo";
		if (field === "conversation")
			turn.binding.conversationId = "foreign-conversation";
		if (field === "author")
			turn.binding.agentIdentityId = "foreign-author";
		await expect(f.custody.loadDeclaration(turn)).rejects.toThrow("crossed its original coordinates");
	});

	it.each(["ciphertext", "ciphertext-with-recomputed-digest", "nonce", "authTag"])("authenticates %s on recovered content", async function _CiphertextIntegrity(field)
	{
		const f = _Fixture();
		const reference = await f.custody.storeDeclaration(_TURN, _DECLARATION);
		const row = f.rows.get(reference.payloadRef)!;
		const bytes = Buffer.from(row[field === "ciphertext-with-recomputed-digest" ? "ciphertext" : field]);
		bytes[0] ^= 1;
		row[field === "ciphertext-with-recomputed-digest" ? "ciphertext" : field] = bytes;
		if (field === "ciphertext-with-recomputed-digest")
			row.ciphertextDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
		await expect(f.custody.loadDeclaration(_TURN)).rejects.toThrow();
	});

	it.each(["future-acceptance", "acceptance-at-deadline", "extended-dispatch", "extended-key", "changed-attempt", "changed-fence"])("rejects %s before storage and after decrypting saved content", async function _AcceptanceBounds(kind)
	{
		const f = _Fixture();
		const value = { ..._DECLARATION };
		if (kind === "future-acceptance")
			value.acceptedAtEpochMs = _NOW + 1;
		if (kind === "acceptance-at-deadline")
			value.requestNotAfterEpochMs = value.acceptedAtEpochMs;
		if (kind === "extended-dispatch")
			value.requestNotAfterEpochMs = _TURN.modelReservation.dispatchDeadlineEpochMs + 1;
		if (kind === "extended-key")
			value.credentialExpiresAt = new Date(value.requestNotAfterEpochMs - 1).toISOString();
		if (kind === "changed-attempt")
			value.attempt = 2;
		if (kind === "changed-fence")
			value.modelInvocationFence = "61c1f1dc-0010-4f13-9c2f-d3841ffd6651";
		await expect(f.custody.storeDeclaration(_TURN, value)).rejects.toThrow("crossed its original accepted response");
		expect(f.payload.create).not.toHaveBeenCalled();
		const reference = await f.custody.storeDeclaration(_TURN, _DECLARATION);
		const row = f.rows.get(reference.payloadRef)!;
		Object.assign(row, f.cipher.encrypt(___CanonicalizeJson({ ...value, call: { ...value.call } }), { siloId: row.siloId, conversationId: row.conversationId, authorSubject: row.authorSubject, payloadRef: row.id }));
		await expect(f.custody.loadDeclaration(_TURN)).rejects.toThrow("crossed its original accepted response");
	});

	it("keeps the declaration and exact continuation in separate ciphertext rows", async function _Continuation()
	{
		const f = _Fixture();
		const { turn, continuation } = await _Selected(f);
		const reference = await f.custody.storeContinuation(turn, continuation);
		expect(reference.payloadRef).not.toBe(continuation.declaration.payloadRef);
		await expect(f.custody.loadContinuation(turn, reference)).resolves.toEqual(continuation);
		await expect(f.custody.storeContinuation(turn, continuation)).resolves.toEqual(reference);
		await expect(f.custody.storeContinuation(turn, { ...continuation, resultContent: "different private result" })).rejects.toThrow("cannot replace saved content");
		expect(f.rows.size).toBe(2);
		expect(f.payload.create).toHaveBeenCalledTimes(2);
		expect(f.forbidden).not.toHaveBeenCalled();
	});

	it.each(["payload-reference", "ciphertext-digest", "missing", "different-invocation"])("requires the continuation's saved %s", async function _ContinuationReference(kind)
	{
		const f = _Fixture();
		const selected = await _Selected(f);
		let turn = selected.turn;
		const reference = await f.custody.storeContinuation(turn, selected.continuation);
		if (kind === "payload-reference")
			reference.payloadRef = selected.continuation.declaration.payloadRef;
		if (kind === "ciphertext-digest")
			reference.ciphertextDigest = _DIGEST;
		if (kind === "missing")
			f.rows.delete(reference.payloadRef);
		if (kind === "different-invocation")
			turn = { ...turn, modelReservation: { ..._TURN.modelReservation, invocationFence: "61c1f1dc-0010-4f13-9c2f-d3841ffd6651" } };
		await expect(f.custody.loadContinuation(turn, reference)).rejects.toThrow("differs from its saved reference");
	});

	it("requires the original tool selection and frozen input for continuation custody", async function _Selection()
	{
		const f = _Fixture();
		const { turn, continuation } = await _Selected(f);
		await expect(f.custody.storeContinuation(_TURN, continuation)).rejects.toThrow("crossed its original tool selection");
		await expect(f.custody.storeContinuation(turn, { ...continuation, compiledInputDigest: `sha256:${"b".repeat(64)}` })).rejects.toThrow("crossed its original tool selection");
		await expect(f.custody.storeContinuation(turn, { ...continuation, declaration: { ...continuation.declaration, ciphertextDigest: _DIGEST } })).rejects.toThrow("crossed its original tool selection");
		expect(f.payload.create).toHaveBeenCalledTimes(1);
	});
});
