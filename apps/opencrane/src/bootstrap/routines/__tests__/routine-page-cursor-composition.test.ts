import { randomBytes } from "node:crypto";

import { RoutinePageCursorCipherAdapter, RoutinePageCursorEndpoints, type RoutinePageCursorContext, type RoutinePagePosition } from "@opencrane/backend/server/agents/scheduling";
import { AesGcmConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";
import { describe, expect, it } from "vitest";

/** Stable page position used by every cursor fixture. */
const _POSITION: RoutinePagePosition = { createdAt: "2026-09-01T01:00:00.000Z", id: "routine-1" };
/** Authenticated caller and endpoint coordinates used by the cursor adapter. */
const _CONTEXT: RoutinePageCursorContext = { caller: { siloId: "silo-1", principalId: "principal-1", issuer: "https://issuer.example", subjectId: "subject-1", authenticatedAt: "2026-09-01T00:00:00.000Z" }, endpoint: RoutinePageCursorEndpoints.Routines, routineId: null };

/** Creates the mounted AES-GCM cipher used by production conversation payloads. */
function _Adapter(): RoutinePageCursorCipherAdapter
{
	const cipher = new AesGcmConversationPrivatePayloadCipher("key-1", { "key-1": randomBytes(32).toString("base64url") });
	return new RoutinePageCursorCipherAdapter(cipher);
}

/** Re-encodes an envelope fixture after changing one structural field. */
function _Token(envelope: Record<string, unknown>): string
{
	return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
}

/** Reads the public envelope without weakening the test's opaque-token assertions. */
function _Envelope(token: string): Record<string, unknown>
{
	return JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as Record<string, unknown>;
}

describe("routine page cursor composition", function _Suite()
{
	it("round-trips a position and keeps the identifier out of the opaque token", async function _RoundTrip()
	{
		const adapter = _Adapter();
		const token = await adapter.encode(_POSITION, _CONTEXT);

		expect(token).not.toContain(_POSITION.id);
		expect(token).toMatch(/^[A-Za-z0-9_-]+$/u);
		await expect(adapter.decode(token, _CONTEXT)).resolves.toEqual(_POSITION);
	});

	it("accepts the maximum 200-character position identifier", async function _MaximumIdentifier()
	{
		const adapter = _Adapter();
		const position = { ..._POSITION, id: "x".repeat(200) };
		const token = await adapter.encode(position, _CONTEXT);

		await expect(adapter.decode(token, _CONTEXT)).resolves.toEqual(position);
	});

	it.each([
		["caller principal", { ..._CONTEXT, caller: { ..._CONTEXT.caller, principalId: "principal-2" } }],
		["caller issuer", { ..._CONTEXT, caller: { ..._CONTEXT.caller, issuer: "https://other.example" } }],
		["caller subject", { ..._CONTEXT, caller: { ..._CONTEXT.caller, subjectId: "subject-2" } }],
		["caller silo", { ..._CONTEXT, caller: { ..._CONTEXT.caller, siloId: "silo-2" } }],
		["endpoint", { ..._CONTEXT, endpoint: RoutinePageCursorEndpoints.Firings, routineId: "routine-1" }],
		["history routine", { ..._CONTEXT, endpoint: RoutinePageCursorEndpoints.Firings, routineId: "routine-2" }],
	] as const)("binds the cursor to %s", async function _BoundCoordinate(_label, changedContext)
	{
		const adapter = _Adapter();
		const token = await adapter.encode(_POSITION, changedContext);

		await expect(adapter.decode(token, _CONTEXT)).rejects.toThrow("routine page cursor is invalid");
	});

	it.each([
		["noncanonical base64", "eyJ4IjoxfQ="],
		["invalid envelope", _Token({ keyId: "key-1" })],
		["fixed nonce length", _Token({ keyId: "key-1", nonce: "AQ", authTag: "AAAAAAAAAAAAAAAAAAAAAA", ciphertext: "", ciphertextDigest: `sha256:${"0".repeat(64)}` })],
		["fixed tag length", _Token({ keyId: "key-1", nonce: "AAAAAAAAAAAAAAAA", authTag: "AQ", ciphertext: "", ciphertextDigest: `sha256:${"0".repeat(64)}` })],
		["oversized token", "A".repeat(2049)],
	] as const)("rejects %s", async function _RejectsMalformed(_label, token)
	{
		await expect(_Adapter().decode(token, _CONTEXT)).rejects.toThrow("routine page cursor is invalid");
	});

	it("rejects tampered ciphertext and enforces the 2048-character public limit", async function _RejectsTamperingAndLimit()
	{
		const adapter = _Adapter();
		const token = await adapter.encode(_POSITION, _CONTEXT);
		const envelope = _Envelope(token);
		const ciphertext = String(envelope.ciphertext);
		const tampered = _Token({ ...envelope, ciphertext: `${ciphertext.slice(0, -1)}${ciphertext.endsWith("A") ? "B" : "A"}` });

		await expect(adapter.decode(tampered, _CONTEXT)).rejects.toThrow("routine page cursor is invalid");
		await expect(adapter.decode("A".repeat(2049), _CONTEXT)).rejects.toThrow("routine page cursor is invalid");
	});

	it("rejects an invalid position before encryption", async function _RejectsInvalidPosition()
	{
		await expect(_Adapter().encode({ ..._POSITION, id: " " }, _CONTEXT)).rejects.toThrow();
	});
});
