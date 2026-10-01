import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { AesGcmConversationPrivatePayloadCipher, type ConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";

import { GENERATED_FILE_CUSTODY_LIMITS, __ExpectedGeneratedFilePayloadRef, __OpenGeneratedFile, __SealGeneratedFile } from "../file-custody";
import type { GeneratedFileCustodyManifest, SealGeneratedFileCommand, SealedGeneratedFileChunk } from "../file-custody.types";

/** Immutable ownership coordinates supplied by the future generated-resource consumer. */
const _IDENTITY = { siloId: "silo-1", conversationId: "conversation-1", agentIdentityId: "agent-identity-1", requesterPrincipalId: "principal-1", requesterSubjectId: "subject-1", operationId: "tool-invocation-1" } as const;

/** Creates an actual AES-GCM private-payload cipher with one test key. */
function _Cipher(): AesGcmConversationPrivatePayloadCipher
{
	return new AesGcmConversationPrivatePayloadCipher("key-1", { "key-1": randomBytes(32).toString("base64url") });
}

/** Creates one valid seal command around exact bytes. */
function _Command(bytes: Uint8Array): SealGeneratedFileCommand
{
	return { ..._IDENTITY, bytes };
}

/** Computes the full content address used in assertions. */
function _Digest(bytes: Uint8Array): string
{
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

describe("generated file encrypted custody", function _GeneratedFileCustodySuite()
{
	it("seals and opens a multi-chunk file without retaining plaintext in its manifest or rows", function _RoundTrips()
	{
		const cipher = _Cipher();
		const original = Buffer.alloc(GENERATED_FILE_CUSTODY_LIMITS.chunkBytes + 17, 0x61);
		const bytes = Buffer.from(original);
		const sealed = __SealGeneratedFile(cipher, _Command(bytes));
		bytes.fill(0x62);

		expect(sealed.manifest).toMatchObject({ ..._IDENTITY, byteLength: original.byteLength, chunkCount: 2, contentAddress: _Digest(original) });
		expect(sealed.chunks.every(function _AgentAuthored(chunk) { return chunk.coordinates.authorSubject === _IDENTITY.agentIdentityId; })).toBe(true);
		expect(sealed.manifest.chunks.map(function _Length(chunk) { return chunk.decodedByteLength; })).toEqual([GENERATED_FILE_CUSTODY_LIMITS.chunkBytes, 17]);
		expect(Buffer.from(sealed.chunks[0]!.payload.ciphertext)).not.toEqual(Buffer.from(original.subarray(0, GENERATED_FILE_CUSTODY_LIMITS.chunkBytes).toString("base64"), "utf8"));
		expect(Buffer.from(__OpenGeneratedFile(cipher, sealed.manifest, sealed.chunks))).toEqual(original);
	});

	it("keeps payload references stable while using fresh ciphertext only on first capture", function _UsesFreshNonces()
	{
		const cipher = _Cipher();
		const first = __SealGeneratedFile(cipher, _Command(Buffer.from("saved once")));
		const second = __SealGeneratedFile(cipher, _Command(Buffer.from("saved once")));

		expect(second.chunks[0]!.payloadRef).toBe(first.chunks[0]!.payloadRef);
		expect(second.chunks[0]!.payload.nonce).not.toEqual(first.chunks[0]!.payload.nonce);
		expect(second.chunks[0]!.payload.ciphertextDigest).not.toBe(first.chunks[0]!.payload.ciphertextDigest);
		expect(second.manifest.ciphertextManifestDigest).not.toBe(first.manifest.ciphertextManifestDigest);
	});

	it("binds a payload reference to every owner, operation, position and full-content coordinate", function _BindsReference()
	{
		const sealed = __SealGeneratedFile(_Cipher(), _Command(Buffer.alloc(GENERATED_FILE_CUSTODY_LIMITS.chunkBytes + 1, 9)));
		const manifest = sealed.manifest;
		const coordinates = { ..._IDENTITY, byteLength: manifest.byteLength, chunkIndex: 0, chunkCount: manifest.chunkCount, contentAddress: manifest.contentAddress };
		const reference = __ExpectedGeneratedFilePayloadRef(coordinates);
		const changed = [
			{ ...coordinates, siloId: "other" },
			{ ...coordinates, conversationId: "other" },
			{ ...coordinates, agentIdentityId: "other" },
			{ ...coordinates, requesterPrincipalId: "other" },
			{ ...coordinates, requesterSubjectId: "other" },
			{ ...coordinates, operationId: "other" },
			{ ...coordinates, chunkIndex: 1 },
			{ ...coordinates, byteLength: 1, chunkCount: 1 },
			{ ...coordinates, contentAddress: `sha256:${"a".repeat(64)}` },
		];

		expect(reference).toBe(manifest.chunks[0]!.payloadRef);
		for (const candidate of changed)
			expect(__ExpectedGeneratedFilePayloadRef(candidate)).not.toBe(reference);
	});

	it("supports the exact one MiB ceiling and rejects empty or larger files", function _EnforcesFileLimit()
	{
		const cipher = _Cipher();
		const maximum = __SealGeneratedFile(cipher, _Command(Buffer.alloc(GENERATED_FILE_CUSTODY_LIMITS.fileBytes, 7)));

		expect(maximum.manifest.chunkCount).toBe(22);
		expect(Buffer.from(__OpenGeneratedFile(cipher, maximum.manifest, maximum.chunks)).byteLength).toBe(GENERATED_FILE_CUSTODY_LIMITS.fileBytes);
		expect(function _Empty() { __SealGeneratedFile(cipher, _Command(Buffer.alloc(0))); }).toThrow("1 to 1048576 bytes");
		expect(function _TooLarge() { __SealGeneratedFile(cipher, _Command(Buffer.alloc(GENERATED_FILE_CUSTODY_LIMITS.fileBytes + 1))); }).toThrow("1 to 1048576 bytes");
	});

	it("rejects omitted, reordered, duplicated and foreign ciphertext rows", function _RejectsWrongRows()
	{
		const cipher = _Cipher();
		const sealed = __SealGeneratedFile(cipher, _Command(Buffer.alloc(GENERATED_FILE_CUSTODY_LIMITS.chunkBytes + 1, 3)));
		const foreign = __SealGeneratedFile(cipher, { ..._Command(Buffer.alloc(GENERATED_FILE_CUSTODY_LIMITS.chunkBytes + 1, 3)), operationId: "foreign-operation" });
		const foreignAgent = __SealGeneratedFile(cipher, { ..._Command(Buffer.alloc(GENERATED_FILE_CUSTODY_LIMITS.chunkBytes + 1, 3)), agentIdentityId: "foreign-agent" });

		expect(function _Omitted() { __OpenGeneratedFile(cipher, sealed.manifest, sealed.chunks.slice(1)); }).toThrow("chunks do not match");
		expect(function _Reordered() { __OpenGeneratedFile(cipher, sealed.manifest, [...sealed.chunks].reverse()); }).toThrow("chunks do not match");
		expect(function _Duplicated() { __OpenGeneratedFile(cipher, sealed.manifest, [sealed.chunks[0], sealed.chunks[0]]); }).toThrow("chunks do not match");
		expect(function _Foreign() { __OpenGeneratedFile(cipher, sealed.manifest, [foreign.chunks[0], sealed.chunks[1]]); }).toThrow("chunks do not match");
		expect(function _ForeignAgent() { __OpenGeneratedFile(cipher, sealed.manifest, [foreignAgent.chunks[0], sealed.chunks[1]]); }).toThrow("chunks do not match");
	});

	it("rejects changed ownership coordinates, ciphertext and ordered manifest evidence", function _RejectsTampering()
	{
		const cipher = _Cipher();
		const sealed = __SealGeneratedFile(cipher, _Command(Buffer.from("protected")));
		const chunk = sealed.chunks[0]!;
		const foreignCoordinates: SealedGeneratedFileChunk = { ...chunk, coordinates: { ...chunk.coordinates, conversationId: "foreign" } };
		const changedCiphertext: SealedGeneratedFileChunk = { ...chunk, payload: { ...chunk.payload, ciphertext: Buffer.from("changed") } };
		const changedManifest: GeneratedFileCustodyManifest = { ...sealed.manifest, chunks: [{ ...sealed.manifest.chunks[0]!, ciphertextDigest: `sha256:${"f".repeat(64)}` }] };

		expect(function _ForeignCoordinates() { __OpenGeneratedFile(cipher, sealed.manifest, [foreignCoordinates]); }).toThrow("chunks do not match");
		expect(function _ChangedCiphertext() { __OpenGeneratedFile(cipher, sealed.manifest, [changedCiphertext]); }).toThrow("ciphertext digest");
		expect(function _ChangedManifest() { __OpenGeneratedFile(cipher, changedManifest, sealed.chunks); }).toThrow("manifest is invalid");
	});

	it("rejects non-canonical base64 and changed decrypted bytes before release", function _RejectsPlaintextMutation()
	{
		const cipher = _Cipher();
		const sealed = __SealGeneratedFile(cipher, _Command(Buffer.from("a")));
		const nonCanonical = _DecryptingAs(cipher, "YQ");
		const changedPlaintext = _DecryptingAs(cipher, Buffer.from("b").toString("base64"));

		expect(function _NonCanonical() { __OpenGeneratedFile(nonCanonical, sealed.manifest, sealed.chunks); }).toThrow("plaintext is invalid");
		expect(function _ChangedPlaintext() { __OpenGeneratedFile(changedPlaintext, sealed.manifest, sealed.chunks); }).toThrow("content digest does not match");
	});
});

/** Wraps the real cipher while substituting only its decrypted text for fail-closed tests. */
function _DecryptingAs(cipher: ConversationPrivatePayloadCipher, plaintext: string): ConversationPrivatePayloadCipher
{
	return {
		decrypt(payload, coordinates) { cipher.decrypt(payload, coordinates); return plaintext; },
		encrypt(value, coordinates) { return cipher.encrypt(value, coordinates); },
	};
}
