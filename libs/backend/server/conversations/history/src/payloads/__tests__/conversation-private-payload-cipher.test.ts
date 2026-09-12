import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { AesGcmConversationPrivatePayloadCipher } from "../conversation-private-payload-cipher";

/** Exact authenticated ownership coordinates shared by encryption and decryption. */
const _COORDINATES = { siloId: "silo-1", conversationId: "conversation-1", payloadRef: "payload-1", authorSubject: "subject-1" } as const;

/** Creates a valid rotating keyring with one current 256-bit key. */
function _Cipher(): AesGcmConversationPrivatePayloadCipher
{
	return new AesGcmConversationPrivatePayloadCipher("key-1", { "key-1": randomBytes(32).toString("base64url") });
}

describe("AesGcmConversationPrivatePayloadCipher", function _DescribeCipher()
{
	it("round-trips UTF-8 plaintext while storing only ciphertext and its digest", function _RoundTrips()
	{
		const cipher = _Cipher();
		const encrypted = cipher.encrypt("hello from Nairobi", _COORDINATES);
		expect(Buffer.from(encrypted.ciphertext).toString("utf8")).not.toContain("hello");
		expect(encrypted.ciphertextDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(cipher.decrypt(encrypted, _COORDINATES)).toBe("hello from Nairobi");
	});

	it("fails closed when ciphertext or authenticated conversation coordinates change", function _RejectsTampering()
	{
		const cipher = _Cipher();
		const encrypted = cipher.encrypt("private", _COORDINATES);
		expect(function _WrongConversation() { cipher.decrypt(encrypted, { ..._COORDINATES, conversationId: "conversation-2" }); }).toThrow();
		expect(function _WrongCiphertext() { cipher.decrypt({ ...encrypted, ciphertext: Buffer.from("changed") }, _COORDINATES); }).toThrow("digest");
	});

	it("authenticates empty attachment-only text without a sentinel or transferable ownership", function _EmptyText()
	{
		const cipher = _Cipher();
		const encrypted = cipher.encrypt("", _COORDINATES);
		expect(encrypted.ciphertext.byteLength).toBe(0);
		expect(encrypted.authTag.byteLength).toBe(16);
		expect(cipher.decrypt(encrypted, _COORDINATES)).toBe("");
		expect(function _WrongOwner() { cipher.decrypt(encrypted, { ..._COORDINATES, authorSubject: "other" }); }).toThrow();
		expect(function _InvalidTag() { cipher.decrypt({ ...encrypted, authTag: randomBytes(16) }, _COORDINATES); }).toThrow();
	});

	it("rejects missing current keys and non-256-bit key material", function _RejectsInvalidKeyrings()
	{
		expect(function _MissingCurrent() { new AesGcmConversationPrivatePayloadCipher("key-2", { "key-1": randomBytes(32).toString("base64url") }); }).toThrow("current key");
		expect(function _ShortKey() { new AesGcmConversationPrivatePayloadCipher("key-1", { "key-1": randomBytes(16).toString("base64url") }); }).toThrow("256-bit");
	});
});
