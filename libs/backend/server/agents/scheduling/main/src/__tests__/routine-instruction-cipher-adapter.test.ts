import { describe, expect, it, vi } from "vitest";

import { RoutineInstructionCipherAdapter } from "../routine-instruction-cipher-adapter";
import type { RoutineInstructionPayloadCipher, RoutineInstructionPayloadCiphertext, RoutineInstructionPayloadCoordinates } from "../routine-instruction-cipher-adapter.types";
import type { RoutineInstructionContext, RoutineInstructionEnvelope } from "../routine-instruction.types";

/** Exact routine context used by adapter tests. */
const _CONTEXT: RoutineInstructionContext = { siloId: "silo-1", destinationConversationId: "destination-1", requesterSubjectId: "subject-1", routineId: "routine-1", routineRevision: 2 };
/** Valid digest returned by a shared payload cipher. */
const _DIGEST = `sha256:${"a".repeat(64)}` as const;
/** Valid routine envelope used by decrypt delegation tests. */
const _ENVELOPE: RoutineInstructionEnvelope = { keyId: "key-1", nonce: new Uint8Array([1, 2]), authTag: new Uint8Array([3, 4]), ciphertext: new Uint8Array([5, 6]), ciphertextDigest: _DIGEST };

/** Builds an inspectable structural cipher with valid default results. */
function _PayloadCipher()
{
	const encrypted: RoutineInstructionPayloadCiphertext = { keyId: "key-1", nonce: Buffer.from([1, 2]), authTag: Buffer.from([3, 4]), ciphertext: Buffer.from([5, 6]), ciphertextDigest: _DIGEST };
	const encrypt = vi.fn().mockReturnValue(encrypted);
	const decrypt = vi.fn().mockReturnValue("plan the weekly review");
	return { cipher: { encrypt, decrypt } satisfies RoutineInstructionPayloadCipher, encrypted, encrypt, decrypt };
}

describe("RoutineInstructionCipherAdapter", function _Suite()
{
	it("round-trips through the injected cipher and copies its byte views", async function _RoundTrip()
	{
		const fixture = _PayloadCipher();
		const adapter = new RoutineInstructionCipherAdapter(fixture.cipher);

		const envelope = await adapter.encrypt("plan the weekly review", _CONTEXT);
		await expect(adapter.decrypt(envelope, _CONTEXT)).resolves.toBe("plan the weekly review");

		const coordinates = { siloId: "silo-1", conversationId: "destination-1", authorSubject: "subject-1", payloadRef: JSON.stringify(["opencrane:routine-instruction:v1", "routine-1", 2]) };
		expect(fixture.encrypt).toHaveBeenCalledWith("plan the weekly review", coordinates);
		expect(fixture.decrypt).toHaveBeenCalledWith(envelope, coordinates);
		expect(envelope).toEqual({ ...fixture.encrypted, nonce: new Uint8Array([1, 2]), authTag: new Uint8Array([3, 4]), ciphertext: new Uint8Array([5, 6]) });
		expect(envelope.nonce).not.toBe(fixture.encrypted.nonce);
		expect(envelope.authTag).not.toBe(fixture.encrypted.authTag);
		expect(envelope.ciphertext).not.toBe(fixture.encrypted.ciphertext);
		expect(envelope.nonce.buffer).not.toBe(fixture.encrypted.nonce.buffer);
	});

	it("binds every owner coordinate and encodes purpose, routine, and revision without delimiter ambiguity", async function _Coordinates()
	{
		const fixture = _PayloadCipher();
		const adapter = new RoutineInstructionCipherAdapter(fixture.cipher);
		const variants: readonly RoutineInstructionContext[] = [
			_CONTEXT,
			{ ..._CONTEXT, siloId: "silo-2" },
			{ ..._CONTEXT, destinationConversationId: "destination-2" },
			{ ..._CONTEXT, requesterSubjectId: "subject-2" },
			{ ..._CONTEXT, routineId: "routine-2" },
			{ ..._CONTEXT, routineRevision: 3 },
			{ ..._CONTEXT, routineId: "routine:[1],2", routineRevision: 12 },
		];

		for (const context of variants)
		{
			await adapter.encrypt("instruction", context);
		}

		const coordinates = fixture.encrypt.mock.calls.map(function _Coordinate(call) { return call[1] as RoutineInstructionPayloadCoordinates; });
		expect(new Set(coordinates.map(function _Key(value) { return JSON.stringify(value); })).size).toBe(variants.length);
		expect(coordinates[1]?.siloId).toBe("silo-2");
		expect(coordinates[2]?.conversationId).toBe("destination-2");
		expect(coordinates[3]?.authorSubject).toBe("subject-2");
		expect(coordinates[4]?.payloadRef).not.toBe(coordinates[0]?.payloadRef);
		expect(coordinates[5]?.payloadRef).not.toBe(coordinates[0]?.payloadRef);
		expect(JSON.parse(coordinates[6]!.payloadRef)).toEqual(["opencrane:routine-instruction:v1", "routine:[1],2", 12]);
	});

	it.each([
		["missing context", null],
		["blank silo", { ..._CONTEXT, siloId: " " }],
		["padded destination", { ..._CONTEXT, destinationConversationId: " destination-1" }],
		["blank requester", { ..._CONTEXT, requesterSubjectId: "" }],
		["padded routine", { ..._CONTEXT, routineId: "routine-1 " }],
		["zero revision", { ..._CONTEXT, routineRevision: 0 }],
		["fractional revision", { ..._CONTEXT, routineRevision: 1.5 }],
		["unsafe revision", { ..._CONTEXT, routineRevision: Number.MAX_SAFE_INTEGER + 1 }],
		["unknown context field", { ..._CONTEXT, unexpected: true }],
	])("rejects %s before encryption or decryption", async function _InvalidContext(_name, context)
	{
		const fixture = _PayloadCipher();
		const adapter = new RoutineInstructionCipherAdapter(fixture.cipher);

		await expect(adapter.encrypt("secret instruction", context as RoutineInstructionContext)).rejects.toThrow("cipher context is invalid");
		await expect(adapter.decrypt(_ENVELOPE, context as RoutineInstructionContext)).rejects.toThrow("cipher context is invalid");
		expect(fixture.encrypt).not.toHaveBeenCalled();
		expect(fixture.decrypt).not.toHaveBeenCalled();
	});

	it.each([
		["missing payload", null],
		["blank key identifier", { keyId: " " }],
		["nonce", { nonce: "not-bytes" }],
		["authentication tag", { authTag: null }],
		["ciphertext", { ciphertext: [] }],
		["digest prefix", { ciphertextDigest: "sha512:" + "a".repeat(64) }],
		["digest length", { ciphertextDigest: "sha256:abc" }],
		["digest case", { ciphertextDigest: `sha256:${"A".repeat(64)}` }],
		["unknown envelope field", { unexpected: true }],
	])("rejects an invalid shared-cipher %s result", async function _InvalidEnvelope(_name, patch)
	{
		const fixture = _PayloadCipher();
		const result = patch === null ? null : { ...fixture.encrypted, ...patch };
		fixture.encrypt.mockReturnValue(result as never);
		const adapter = new RoutineInstructionCipherAdapter(fixture.cipher);

		await expect(adapter.encrypt("secret instruction", _CONTEXT)).rejects.toThrow("cipher envelope is invalid");
		await expect(adapter.decrypt(result as never, _CONTEXT)).rejects.toThrow("cipher envelope is invalid");
		expect(fixture.decrypt).not.toHaveBeenCalled();
	});

	it("delegates plaintext limits, tampering, unavailable keys, and rotation to the shared cipher", async function _DelegatesCipherRules()
	{
		const fixture = _PayloadCipher();
		fixture.encrypt.mockImplementation(function _Encrypt(plaintext: string)
		{
			if (Buffer.byteLength(plaintext, "utf8") > 16)
			{
				throw new Error("Shared payload text exceeds its size limit");
			}
			return { ...fixture.encrypted, keyId: "key-new" };
		});
		fixture.decrypt.mockImplementation(function _Decrypt(payload: RoutineInstructionPayloadCiphertext)
		{
			if (payload.keyId === "key-missing")
			{
				throw new Error("Shared payload references an unavailable key");
			}
			if (payload.ciphertext[0] === 255)
			{
				throw new Error("Shared payload ciphertext digest does not match");
			}
			return "instruction from an older key";
		});
		const adapter = new RoutineInstructionCipherAdapter(fixture.cipher);

		await expect(adapter.encrypt("x".repeat(17), _CONTEXT)).rejects.toThrow("size limit");
		await expect(adapter.encrypt("short", _CONTEXT)).resolves.toMatchObject({ keyId: "key-new" });
		await expect(adapter.decrypt({ ..._ENVELOPE, keyId: "key-missing" }, _CONTEXT)).rejects.toThrow("unavailable key");
		await expect(adapter.decrypt({ ..._ENVELOPE, ciphertext: new Uint8Array([255]) }, _CONTEXT)).rejects.toThrow("digest");
		await expect(adapter.decrypt({ ..._ENVELOPE, keyId: "key-old" }, _CONTEXT)).resolves.toBe("instruction from an older key");
	});
});
