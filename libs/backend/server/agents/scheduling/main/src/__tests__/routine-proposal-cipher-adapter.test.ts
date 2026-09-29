import { describe, expect, it, vi } from "vitest";

import { RoutineProposalCipherAdapter } from "../routine-proposal-cipher-adapter";

const _ENVELOPE = { keyId: "key-1", nonce: new Uint8Array([1]), authTag: new Uint8Array([2]), ciphertext: new Uint8Array([3]), ciphertextDigest: `sha256:${"a".repeat(64)}` } as const;
const _CONTEXT = { siloId: "silo-1", sourceConversationId: "conversation-1", requesterPrincipalId: "principal-1", proposalId: "proposal-1" } as const;
const _SUGGESTION = { instruction: "Prepare a report.", schedule: { expression: "0 8 * * *", timezone: "UTC" } } as const;

describe("routine proposal cipher adapter", function _Suite()
{
	it("uses a proposal-only authenticated-data purpose and round-trips strict suggestion JSON", async function _RoundTrip()
	{
		const encrypt = vi.fn().mockReturnValue(_ENVELOPE);
		const decrypt = vi.fn().mockReturnValue(JSON.stringify(_SUGGESTION));
		const adapter = new RoutineProposalCipherAdapter({ encrypt, decrypt });

		await expect(adapter.encrypt(_SUGGESTION, _CONTEXT)).resolves.toEqual(_ENVELOPE);
		await expect(adapter.decrypt(_ENVELOPE, _CONTEXT)).resolves.toEqual(_SUGGESTION);

		const coordinates = { siloId: "silo-1", conversationId: "conversation-1", authorSubject: "principal-1", payloadRef: JSON.stringify(["opencrane:routine-proposal:v1", "proposal-1"]) };
		expect(encrypt).toHaveBeenCalledWith(JSON.stringify(_SUGGESTION), coordinates);
		expect(decrypt).toHaveBeenCalledWith(expect.objectContaining({ ciphertextDigest: _ENVELOPE.ciphertextDigest }), coordinates);
		expect(JSON.stringify(coordinates)).not.toContain("Prepare a report");
	});

	it("rejects malformed decrypted content without disclosing it", async function _Malformed()
	{
		const adapter = new RoutineProposalCipherAdapter({ encrypt: vi.fn().mockReturnValue(_ENVELOPE), decrypt: vi.fn().mockReturnValue('{"instruction":"secret"}') });
		await expect(adapter.decrypt(_ENVELOPE, _CONTEXT)).rejects.toThrow("Routine proposal plaintext is invalid");
	});
});
