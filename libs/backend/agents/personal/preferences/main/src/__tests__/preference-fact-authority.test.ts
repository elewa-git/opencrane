import { describe, expect, it, vi } from "vitest";

import { __AcceptPreferenceFact, __ForgetPreferenceFact, __RecordPreferenceFact } from "../preference-fact-authority.js";

/** Valid accepted explicit preference used by the pure authority tests. */
const _FACT = { siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1", preferenceKey: "answer.order", statement: "Give the conclusion first.", state: "accepted", consentState: "explicit", provenance: { kind: "explicit_statement", messageId: null, interviewId: null, detail: { source: "user" } }, confidence: 1, sensitivity: "ordinary", supersedesFactId: null, recordedBy: "user-1", acceptedBy: "user-1", idempotencyKey: "preference-1" } as const;

describe("preference fact authority", function _describePreferenceFactAuthority()
{
	it("records an explicit consented fact through the durable repository", async function _recordsAcceptedFact()
	{
		const recordAtomically = vi.fn().mockResolvedValue({ status: "recorded", preferenceFactId: "fact-1" });
		const result = await __RecordPreferenceFact({ recordAtomically, forgetAtomically: vi.fn(), acceptAtomically: vi.fn() }, _FACT);

		expect(result).toEqual({ outcome: "recorded", preferenceFactId: "fact-1", idempotent: false });
		expect(recordAtomically).toHaveBeenCalledWith(_FACT);
	});

	it("denies a sensitive inferred preference before persistence", async function _deniesSensitiveInference()
	{
		const recordAtomically = vi.fn();
		const result = await __RecordPreferenceFact({ recordAtomically, forgetAtomically: vi.fn(), acceptAtomically: vi.fn() }, { ..._FACT, state: "candidate", consentState: "pending", acceptedBy: null, sensitivity: "sensitive", provenance: { kind: "inferred", messageId: "message-1", interviewId: null, detail: { evidence: 3 } } });

		expect(result).toEqual({ outcome: "denied", reason: "invalid_command" });
		expect(recordAtomically).not.toHaveBeenCalled();
	});

	it("requires pending consent until a candidate receives owner confirmation", async function _requiresPendingCandidateConsent()
	{
		const recordAtomically = vi.fn();
		const result = await __RecordPreferenceFact({ recordAtomically, forgetAtomically: vi.fn(), acceptAtomically: vi.fn() }, { ..._FACT, state: "candidate", consentState: "confirmed", acceptedBy: null });

		expect(result).toEqual({ outcome: "denied", reason: "invalid_command" });
		expect(recordAtomically).not.toHaveBeenCalled();
	});

	it("requires the owning user to confirm a candidate before it becomes eligible", async function _acceptsOwnerCandidate()
	{
		const acceptAtomically = vi.fn().mockResolvedValue({ status: "accepted" });
		const repository = { recordAtomically: vi.fn(), forgetAtomically: vi.fn(), acceptAtomically };
		const command = { siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1", preferenceFactId: "fact-1", consentState: "confirmed", acceptedBy: "user-1", acceptedAt: "2026-07-23T12:00:00.000Z" } as const;

		expect(await __AcceptPreferenceFact(repository, command)).toEqual({ outcome: "accepted" });
		expect(acceptAtomically).toHaveBeenCalledWith(command);
		expect(await __AcceptPreferenceFact(repository, { ...command, acceptedBy: "another-user" })).toEqual({ outcome: "denied", reason: "invalid_command" });
	});

	it("denies a correction candidate before it can replace an accepted preference", async function _deniesCandidateCorrection()
	{
		const recordAtomically = vi.fn();
		const result = await __RecordPreferenceFact({ recordAtomically, forgetAtomically: vi.fn(), acceptAtomically: vi.fn() }, { ..._FACT, state: "candidate", consentState: "pending", acceptedBy: null, supersedesFactId: "fact-0" });

		expect(result).toEqual({ outcome: "denied", reason: "invalid_command" });
		expect(recordAtomically).not.toHaveBeenCalled();
	});

	it("forgets by lifecycle transition without deleting the historical fact", async function _forgetsFact()
	{
		const forgetAtomically = vi.fn().mockResolvedValue({ status: "forgotten" });
		const result = await __ForgetPreferenceFact({ recordAtomically: vi.fn(), forgetAtomically, acceptAtomically: vi.fn() }, { siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1", preferenceFactId: "fact-1", forgottenAt: "2026-07-23T12:00:00.000Z" });

		expect(result).toEqual({ outcome: "forgotten" });
	});
});
