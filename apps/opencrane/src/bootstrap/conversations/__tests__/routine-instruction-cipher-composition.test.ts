import { describe, expect, it } from "vitest";

import { RoutineInstructionCipherAdapter, type RoutineInstructionContext } from "@opencrane/backend/server/agents/scheduling";
import { AesGcmConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";

/** Deterministic test keys are never loaded from deployment configuration. */
const _KEYS = { old: Buffer.alloc(32, 17).toString("base64url"), current: Buffer.alloc(32, 34).toString("base64url") };

/** Binds the approved instruction to its original ownership coordinates. */
const _CONTEXT: RoutineInstructionContext = { siloId: "silo-1", destinationConversationId: "destination-1", requesterSubjectId: "subject-1", routineId: "routine-1", routineRevision: 2 };

/** Composes the production cipher and adapter without reading a key file or starting a service. */
function _adapter(currentKeyId = "current")
{
	const cipher = new AesGcmConversationPrivatePayloadCipher(currentKeyId, _KEYS);
	return { cipher, adapter: new RoutineInstructionCipherAdapter(cipher) };
}

describe("routine instruction cipher composition", function _Suite()
{
	it("round-trips the instruction through the real shared AES-GCM implementation", async function _RoundTrip()
	{
		const { adapter } = _adapter();
		const first = await adapter.encrypt("Count inventory and explain the totals.", _CONTEXT);
		const second = await adapter.encrypt("Count inventory and explain the totals.", _CONTEXT);
		expect(first.keyId).toBe("current");
		expect(first.nonce).not.toEqual(second.nonce);
		expect(first.ciphertext).not.toEqual(second.ciphertext);
		await expect(adapter.decrypt(first, _CONTEXT)).resolves.toBe("Count inventory and explain the totals.");
	});

	it.each([
		{ siloId: "silo-2" }, { destinationConversationId: "destination-2" }, { requesterSubjectId: "subject-2" },
		{ routineId: "routine-2" }, { routineRevision: 3 },
	])("rejects moving the encrypted instruction to different coordinates: %j", async function _Coordinates(changed)
	{
		const { adapter } = _adapter();
		const encrypted = await adapter.encrypt("Approved instruction", _CONTEXT);
		await expect(adapter.decrypt(encrypted, { ..._CONTEXT, ...changed })).rejects.toThrow();
	});

	it("cannot decrypt a routine payload as an ordinary conversation payload", async function _Purpose()
	{
		const { adapter, cipher } = _adapter();
		const encrypted = await adapter.encrypt("Approved instruction", _CONTEXT);
		expect(function _DecryptAsChat()
		{
			return cipher.decrypt(encrypted, { siloId: _CONTEXT.siloId, conversationId: _CONTEXT.destinationConversationId, authorSubject: _CONTEXT.requesterSubjectId, payloadRef: _CONTEXT.routineId });
		}).toThrow();
	});

	it("rejects altered ciphertext, authentication tags and unavailable keys", async function _Tampering()
	{
		const { adapter } = _adapter();
		const encrypted = await adapter.encrypt("Approved instruction", _CONTEXT);
		const ciphertext = Uint8Array.from(encrypted.ciphertext);
		ciphertext[0] ^= 1;
		await expect(adapter.decrypt({ ...encrypted, ciphertext }, _CONTEXT)).rejects.toThrow("digest");
		const authTag = Uint8Array.from(encrypted.authTag);
		authTag[0] ^= 1;
		await expect(adapter.decrypt({ ...encrypted, authTag }, _CONTEXT)).rejects.toThrow();
		await expect(adapter.decrypt({ ...encrypted, keyId: "unavailable" }, _CONTEXT)).rejects.toThrow("unavailable key");
	});

	it("reads an older key after rotation and delegates the existing plaintext size limit", async function _Rotation()
	{
		const older = _adapter("old");
		const newer = _adapter();
		const encrypted = await older.adapter.encrypt("Approved instruction", _CONTEXT);
		await expect(newer.adapter.decrypt(encrypted, _CONTEXT)).resolves.toBe("Approved instruction");
		await expect(newer.adapter.encrypt("x".repeat(65_537), _CONTEXT)).rejects.toThrow("65536 UTF-8 bytes");
	});
});
