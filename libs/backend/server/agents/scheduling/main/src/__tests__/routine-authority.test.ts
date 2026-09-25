import { describe, expect, it, vi } from "vitest";

import { RoutineStatus } from "@opencrane/models/agents";

import { RoutineAuthority } from "../routine-authority";
import { RoutineCommandOutcome, type CreateRoutineCommand, type RoutineIdFactory } from "../routine-authority.types";
import type { RoutineInstructionCipher, RoutineInstructionContext, RoutineInstructionEnvelope } from "../routine-instruction.types";
import type { RoutineCommandPersistence } from "../routine-persistence.types";

/** Stable ciphertext used to prove plaintext never enters routine persistence. */
const _ENVELOPE: RoutineInstructionEnvelope = { keyId: "key-1", nonce: new Uint8Array([1]), ciphertext: new Uint8Array([2]), authTag: new Uint8Array([3]), ciphertextDigest: `sha256:${"a".repeat(64)}` };

/** Creates a human command with trusted caller coordinates. */
function _command(): CreateRoutineCommand
{
	return {
		caller: { siloId: "silo-1", principalId: "principal-1", issuer: "https://issuer.example", subjectId: "subject-1", authenticatedAt: "2026-09-25T08:00:00.000Z" },
		destinationConversationId: "conversation-source",
		audiencePrincipalIds: ["principal-2", "principal-1"],
		selectedManagedServiceId: "service-1",
		schedule: { expression: " 0 9 * * 1-5 ", timezone: "Africa/Nairobi" },
		instruction: "  Prepare the daily summary.  ",
		idempotencyKey: " create-1 ",
	};
}

describe("routine authority encryption boundary", function _suite()
{
	it("encrypts normalized instructions before transactional persistence", async function _encrypt()
	{
		const create = vi.fn().mockResolvedValue({ outcome: RoutineCommandOutcome.Committed, routineId: "routine-1", currentRevision: 1, status: RoutineStatus.Active, lifecycleRevision: 1, nextAutomaticOccurrence: "2026-09-25T09:00:00.000Z" });
		const persistence = { create } as unknown as RoutineCommandPersistence;
		const encrypt = vi.fn().mockResolvedValue(_ENVELOPE);
		const cipher = { encrypt, decrypt: vi.fn() } as unknown as RoutineInstructionCipher;
		const ids: RoutineIdFactory = { routineId: () => "routine-1", revisionId: () => "revision-1", firingId: () => "firing-1", conversationId: () => "conversation-1", commandReceiptId: () => "receipt-1" };
		const authority = new RoutineAuthority(persistence, cipher, ids);

		await authority.create(_command());

		const expectedContext: RoutineInstructionContext = { siloId: "silo-1", destinationConversationId: "conversation-source", requesterSubjectId: "subject-1", routineId: "routine-1", routineRevision: 1 };
		expect(encrypt).toHaveBeenCalledExactlyOnceWith("Prepare the daily summary.", expectedContext);
		expect(create).toHaveBeenCalledTimes(1);
		const saved = create.mock.calls[0]?.[0];
		expect(saved.instruction).toEqual(_ENVELOPE);
		expect(saved.schedule).toEqual({ expression: "0 9 * * 1-5", timezone: "Africa/Nairobi" });
		expect(saved.audiencePrincipalIds).toEqual(["principal-1", "principal-2"]);
		expect(JSON.stringify(saved)).not.toContain("Prepare the daily summary");
	});

	it("rejects duplicate or requester-free reviewed audiences before encryption", async function _audience()
	{
		const persistence = { create: vi.fn() } as unknown as RoutineCommandPersistence;
		const cipher = { encrypt: vi.fn(), decrypt: vi.fn() } as unknown as RoutineInstructionCipher;
		const ids: RoutineIdFactory = { routineId: () => "routine-1", revisionId: () => "revision-1", firingId: () => "firing-1", conversationId: () => "conversation-1", commandReceiptId: () => "receipt-1" };
		const authority = new RoutineAuthority(persistence, cipher, ids);

		await expect(authority.create({ ..._command(), audiencePrincipalIds: ["principal-1", "principal-1"] })).rejects.toThrow("unique");
		await expect(authority.create({ ..._command(), audiencePrincipalIds: ["principal-2"] })).rejects.toThrow("original requester");
		expect(cipher.encrypt).not.toHaveBeenCalled();
		expect(persistence.create).not.toHaveBeenCalled();
	});
});
