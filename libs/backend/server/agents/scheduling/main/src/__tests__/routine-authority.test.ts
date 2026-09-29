import { describe, expect, it, vi } from "vitest";

import { RoutineStatus } from "@opencrane/models/agents";
import { RoutineProposalStates } from "@opencrane/contracts";

import { RoutineAuthority } from "../routine-authority";
import { RoutineCommandOutcome, type CreateRoutineCommand, type RoutineIdFactory } from "../routine-authority.types";
import { RoutineCommandValidationError } from "../routine-command.errors";
import type { RoutineInstructionCipher, RoutineInstructionContext, RoutineInstructionEnvelope } from "../routine-instruction.types";
import type { RoutineCommandPersistence } from "../routine-persistence.types";
import type { RoutinePageCursorCodec, RoutineReadPersistence } from "../routine-read.types";
import type { RoutineProposalCipher, RoutineProposalPersistence } from "../routine-proposal.types";

/** Stable ciphertext used to prove plaintext never enters routine persistence. */
const _ENVELOPE: RoutineInstructionEnvelope = { keyId: "key-1", nonce: new Uint8Array([1]), ciphertext: new Uint8Array([2]), authTag: new Uint8Array([3]), ciphertextDigest: `sha256:${"a".repeat(64)}` };

/** Creates a human command with trusted caller coordinates. */
function _command(): CreateRoutineCommand
{
	return {
		caller: { siloId: "silo-1", principalId: "principal-1", issuer: "https://issuer.example", subjectId: "subject-1", authenticatedAt: "2026-09-25T08:00:00.000Z" },
		destinationConversationId: "conversation-source",
		audienceParticipantRefs: ["participant-2", "participant-1"],
		selectedManagedServiceId: "service-1",
		schedule: { expression: " 0 9 * * 1-5 ", timezone: "Africa/Nairobi" },
		instruction: "  Prepare the daily summary.  ",
		idempotencyKey: " create-1 ",
	};
}

/** Keeps authority tests independent from the mounted cursor cipher. */
function _Cursors(): RoutinePageCursorCodec
{
	return { encode: vi.fn(), decode: vi.fn() };
}

/** Keeps routine creation tests independent from the proposal cipher path. */
function _Proposal()
{
	return { cipher: { encrypt: vi.fn(), decrypt: vi.fn() } as unknown as RoutineProposalCipher, ids: { proposalId: () => "proposal-1" } };
}

describe("routine authority encryption boundary", function _suite()
{
	it("encrypts first-party suggestions and decrypts requester-authorized proposal reads outside transactions", async function _ProposalBoundary()
	{
		const propose = vi.fn().mockResolvedValue({ proposalRef: "proposal-1", expiresAt: "2026-09-26T08:00:00.000Z" });
		const readProposal = vi.fn().mockResolvedValue({ proposalRef: "proposal-1", siloId: "silo-1", sourceConversationId: "conversation-source", runId: "run-1", attempt: 1, ordinal: 2, requesterPrincipalId: "principal-1", suggestion: _ENVELOPE, state: RoutineProposalStates.Pending, acceptedRoutineId: null, expiresAt: "2026-09-26T08:00:00.000Z" });
		const persistence = { propose, readProposal } as unknown as RoutineCommandPersistence & RoutineReadPersistence & RoutineProposalPersistence;
		const instructionCipher = { encrypt: vi.fn(), decrypt: vi.fn() } as unknown as RoutineInstructionCipher;
		const proposalCipher = { encrypt: vi.fn().mockResolvedValue(_ENVELOPE), decrypt: vi.fn().mockResolvedValue({ instruction: "Prepare a report.", schedule: { expression: "0 8 * * *", timezone: "UTC" } }) } as unknown as RoutineProposalCipher;
		const ids: RoutineIdFactory = { routineId: () => "routine-1", revisionId: () => "revision-1", firingId: () => "firing-1", conversationId: () => "conversation-1", commandReceiptId: () => "receipt-1" };
		const authority = new RoutineAuthority(persistence, instructionCipher, ids, _Cursors(), proposalCipher, { proposalId: () => "proposal-1" });
		const source = { siloId: "silo-1", sourceConversationId: "conversation-source", runId: "run-1", attempt: 1, ordinal: 2, requesterPrincipalId: "principal-1" } as const;
		const suggestion = { instruction: " Prepare a report. ", schedule: { expression: "0 8 * * *", timezone: "UTC" } };

		await authority.propose({ ...source, suggestion });
		const result = await authority.readProposal({ caller: _command().caller, proposalRef: "proposal-1" });

		expect(propose).toHaveBeenCalledWith(expect.objectContaining({ ...source, proposalId: "proposal-1", suggestion: _ENVELOPE, argumentsDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u) }));
		expect(JSON.stringify(propose.mock.calls)).not.toContain("Prepare a report");
		expect(proposalCipher.decrypt).toHaveBeenCalledWith(_ENVELOPE, { siloId: "silo-1", sourceConversationId: "conversation-source", requesterPrincipalId: "principal-1", proposalId: "proposal-1" });
		expect(result).toMatchObject({ proposalRef: "proposal-1", state: RoutineProposalStates.Pending, suggestion: { instruction: "Prepare a report." } });
	});

	it("encrypts normalized instructions before transactional persistence", async function _encrypt()
	{
		const create = vi.fn().mockResolvedValue({ outcome: RoutineCommandOutcome.Committed, routineId: "routine-1", currentRevision: 1, status: RoutineStatus.Active, lifecycleRevision: 1, nextAutomaticOccurrence: "2026-09-25T09:00:00.000Z" });
		const persistence = { create } as unknown as RoutineCommandPersistence & RoutineReadPersistence & RoutineProposalPersistence;
		const encrypt = vi.fn().mockResolvedValue(_ENVELOPE);
		const cipher = { encrypt, decrypt: vi.fn() } as unknown as RoutineInstructionCipher;
		const ids: RoutineIdFactory = { routineId: () => "routine-1", revisionId: () => "revision-1", firingId: () => "firing-1", conversationId: () => "conversation-1", commandReceiptId: () => "receipt-1" };
		const proposal = _Proposal();
		const authority = new RoutineAuthority(persistence, cipher, ids, _Cursors(), proposal.cipher, proposal.ids);

		await authority.create(_command());

		const expectedContext: RoutineInstructionContext = { siloId: "silo-1", destinationConversationId: "conversation-source", requesterSubjectId: "subject-1", routineId: "routine-1", routineRevision: 1 };
		expect(encrypt).toHaveBeenCalledExactlyOnceWith("Prepare the daily summary.", expectedContext);
		expect(create).toHaveBeenCalledTimes(1);
		const saved = create.mock.calls[0]?.[0];
		expect(saved.instruction).toEqual(_ENVELOPE);
		expect(saved.schedule).toEqual({ expression: "0 9 * * 1-5", timezone: "Africa/Nairobi" });
		expect(saved.audienceParticipantRefs).toEqual(["participant-1", "participant-2"]);
		expect(JSON.stringify(saved)).not.toContain("Prepare the daily summary");
	});

	it("rejects duplicate or requester-free reviewed audiences before encryption", async function _audience()
	{
		const persistence = { create: vi.fn() } as unknown as RoutineCommandPersistence & RoutineReadPersistence & RoutineProposalPersistence;
		const cipher = { encrypt: vi.fn(), decrypt: vi.fn() } as unknown as RoutineInstructionCipher;
		const ids: RoutineIdFactory = { routineId: () => "routine-1", revisionId: () => "revision-1", firingId: () => "firing-1", conversationId: () => "conversation-1", commandReceiptId: () => "receipt-1" };
		const proposal = _Proposal();
		const authority = new RoutineAuthority(persistence, cipher, ids, _Cursors(), proposal.cipher, proposal.ids);

		await expect(authority.create({ ..._command(), audienceParticipantRefs: ["participant-1", "participant-1"] })).rejects.toThrow("unique");
		await expect(authority.create({ ..._command(), audienceParticipantRefs: [" participant-2"] })).rejects.toThrow("unique nonblank participant references");
		await expect(authority.create({ ..._command(), instruction: " " })).rejects.toBeInstanceOf(RoutineCommandValidationError);
		expect(cipher.encrypt).not.toHaveBeenCalled();
		expect(persistence.create).not.toHaveBeenCalled();
	});
});
