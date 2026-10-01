import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { AesGcmConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";
import { ConversationComputerCredentialReceiptCodec } from "../conversation-computer-credential-receipt";

const _INPUT = { bootstrapId: "bootstrap-1", runId: "run-1", attempt: 1, keyAlias: "attempt-1", modelAlias: "model-1", computer: { siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", agentIdentityId: "identity-1" }, lease: { leaseId: "lease-1", leaseGeneration: 1 }, expirySeconds: 300, notAfter: "2026-09-07T00:10:00.000Z", maxBudgetUsd: 0.1 };
const _MINTED = { key: "original-key", expiresAt: "2026-09-07T00:05:00.000Z" };
const _DIGEST = `sha256:${createHash("sha256").update(_MINTED.key).digest("hex")}`;

function _Fixture()
{
	const cipher = {
		encrypt: vi.fn(function _Encrypt(key: string) { return { keyId: "key-1", nonce: Buffer.from("nonce"), authTag: Buffer.from("tag"), ciphertext: Buffer.from(key), ciphertextDigest: "encrypted-digest" }; }),
		decrypt: vi.fn(function _Decrypt(value: { readonly ciphertext: Uint8Array }) { return Buffer.from(value.ciphertext).toString(); }),
	};
	return { cipher, codec: new ConversationComputerCredentialReceiptCodec(cipher) };
}

describe("credential receipt encoding", function _ReceiptEncoding()
{
	it("authenticates the same silo, conversation, attempt and author in both directions", function _Coordinates()
	{
		const { cipher, codec } = _Fixture();
		const custody = codec.seal(_INPUT, "claim-1", _MINTED);
		expect(custody).toMatchObject({ runId: "run-1", attempt: 1, claimFence: "claim-1", credentialDigest: _DIGEST, expiresAt: new Date(_MINTED.expiresAt) });
		expect(codec.open(custody)).toEqual({ ..._MINTED, credentialDigest: _DIGEST });
		const coordinates = { siloId: "silo-1", conversationId: "conversation-1", payloadRef: JSON.stringify(["bootstrap-1", "run-1", 1]), authorSubject: "conversation-computer" };
		expect(cipher.encrypt).toHaveBeenCalledWith(_MINTED.key, coordinates);
		expect(cipher.decrypt).toHaveBeenCalledWith(expect.objectContaining({ ciphertextDigest: "encrypted-digest" }), coordinates);
	});

	it("permits decryption of expired custody for cleanup without authorizing its reuse", function _ExpiredCleanup()
	{
		const { codec } = _Fixture();
		const custody = codec.seal(_INPUT, "claim-1", { ..._MINTED, expiresAt: new Date(0).toISOString() });
		expect(codec.open(custody)).toEqual({ key: _MINTED.key, credentialDigest: _DIGEST, expiresAt: new Date(0).toISOString() });
	});

	it("rejects a changed key digest and incomplete ciphertext before returning a receipt", function _Corruption()
	{
		const { cipher, codec } = _Fixture();
		const custody = codec.seal(_INPUT, "claim-1", _MINTED);
		expect(function _Changed() { codec.open({ ...custody, credentialDigest: "wrong" }); }).toThrow("digest does not match");
		cipher.decrypt.mockClear();
		expect(function _Incomplete() { codec.open({ ...custody, authTag: null }); }).toThrow("not in durable custody");
		expect(cipher.decrypt).not.toHaveBeenCalled();
	});

	it.each([{ runId: "run-2" }, { attempt: 2 }, { bootstrapId: "bootstrap-2" }, { siloId: "silo-2" }, { conversationId: "conversation-2" }])("rejects changed encrypted ownership coordinates %j with the actual cipher", function _AuthenticatedOwnership(changed)
	{
		const cipher = new AesGcmConversationPrivatePayloadCipher("test-key", { "test-key": randomBytes(32).toString("base64url") });
		const codec = new ConversationComputerCredentialReceiptCodec(cipher);
		const custody = codec.seal(_INPUT, "claim-1", _MINTED);
		expect(codec.open(custody)).toEqual({ ..._MINTED, credentialDigest: _DIGEST });
		expect(function _ChangedCoordinates() { codec.open({ ...custody, ...changed }); }).toThrow();
	});
});
