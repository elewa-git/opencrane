import { describe, expect, it, vi } from "vitest";

import { __ApprovePersona } from "../persona-authority";
import { PersonaApprovalDenialReasons, PersonaApprovalInterviewStates, PersonaApprovalPersistenceStatuses, PersonaApprovalRevisionStates } from "../persona-authority.types";
import type { PersonaApprovalSnapshot } from "../persona-authority.types";

/** Build one complete approval snapshot and override only the behaviour under test. */
function _Snapshot(overrides: Partial<PersonaApprovalSnapshot> = {}): PersonaApprovalSnapshot
{
	return { profileUserId: "user-1", activeRevisionId: null, revisionState: PersonaApprovalRevisionStates.Draft, revisionProfileId: "profile-1", interviewState: PersonaApprovalInterviewStates.Completed, insightCount: 3, templateDigestMatches: true, templateSelectionMatches: true, durableSoulMutationPolicy: "forbidden", ...overrides };
}

describe("persona authority", function ()
{
	it("approves only a complete immutable onboarding result", async function ()
	{
		const approveAndActivateAtomically = vi.fn().mockResolvedValue({ status: PersonaApprovalPersistenceStatuses.Approved });
		const getApprovalSnapshot = vi.fn().mockResolvedValue(_Snapshot());
		const result = await __ApprovePersona({ getApprovalSnapshot, approveAndActivateAtomically }, { personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-18T09:00:00.000Z" });
		expect(result).toEqual({ outcome: "approved" });
		expect(approveAndActivateAtomically).toHaveBeenCalledWith(expect.objectContaining({ expectedInsightCount: 3 }));
	});

	it("returns a conflict for the losing concurrent approval after both requests accepted the same snapshot", async function _concurrentConflict()
	{
		let committed = false;
		const approveAndActivateAtomically = vi.fn(async function _approve()
		{
			if (committed) return { status: PersonaApprovalPersistenceStatuses.Conflict };
			committed = true;
			return { status: PersonaApprovalPersistenceStatuses.Approved };
		});
		const getApprovalSnapshot = vi.fn().mockResolvedValue(_Snapshot());
		const command = { personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-18T09:00:00.000Z" };

		const outcomes = await Promise.all([__ApprovePersona({ getApprovalSnapshot, approveAndActivateAtomically }, command), __ApprovePersona({ getApprovalSnapshot, approveAndActivateAtomically }, command)]);

		expect(outcomes).toEqual([{ outcome: "approved" }, { outcome: "denied", reason: PersonaApprovalDenialReasons.Conflict }]);
		expect(approveAndActivateAtomically).toHaveBeenCalledTimes(2);
	});

	it("accepts a retry after this exact revision was already approved and activated", async function _RecoversCommittedApproval()
	{
		const approveAndActivateAtomically = vi.fn();
		const getApprovalSnapshot = vi.fn().mockResolvedValue(_Snapshot({ revisionState: PersonaApprovalRevisionStates.Approved, activeRevisionId: "revision-1" }));

		const result = await __ApprovePersona({ getApprovalSnapshot, approveAndActivateAtomically }, { personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-18T09:00:00.000Z" });

		expect(result).toEqual({ outcome: "approved" });
		expect(approveAndActivateAtomically).not.toHaveBeenCalled();
	});

	it("rejects an approved revision that is not the exact active revision", async function _RejectsInactiveApproval()
	{
		const approveAndActivateAtomically = vi.fn();
		const getApprovalSnapshot = vi.fn().mockResolvedValue(_Snapshot({ revisionState: PersonaApprovalRevisionStates.Approved, activeRevisionId: "revision-other" }));

		const result = await __ApprovePersona({ getApprovalSnapshot, approveAndActivateAtomically }, { personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-18T09:00:00.000Z" });

		expect(result).toEqual({ outcome: "denied", reason: PersonaApprovalDenialReasons.NotDraft });
		expect(approveAndActivateAtomically).not.toHaveBeenCalled();
	});

	it("re-reads a losing CAS and accepts only the exact committed active revision", async function _ReconcilesConcurrentCommit()
	{
		const approveAndActivateAtomically = vi.fn().mockResolvedValue({ status: PersonaApprovalPersistenceStatuses.Conflict });
		const getApprovalSnapshot = vi.fn().mockResolvedValueOnce(_Snapshot()).mockResolvedValueOnce(_Snapshot({ revisionState: PersonaApprovalRevisionStates.Approved, activeRevisionId: "revision-1" }));

		const result = await __ApprovePersona({ getApprovalSnapshot, approveAndActivateAtomically }, { personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-18T09:00:00.000Z" });

		expect(result).toEqual({ outcome: "approved" });
		expect(getApprovalSnapshot).toHaveBeenCalledTimes(2);
	});

	it("retains conflict when a later approval replaced the active revision before the losing CAS re-read", async function _RetainsConflictAfterLaterWinner()
	{
		const approveAndActivateAtomically = vi.fn().mockResolvedValue({ status: PersonaApprovalPersistenceStatuses.Conflict });
		const getApprovalSnapshot = vi.fn().mockResolvedValueOnce(_Snapshot()).mockResolvedValueOnce(_Snapshot({ revisionState: PersonaApprovalRevisionStates.Approved, activeRevisionId: "revision-later" }));

		const result = await __ApprovePersona({ getApprovalSnapshot, approveAndActivateAtomically }, { personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-18T09:00:00.000Z" });

		expect(result).toEqual({ outcome: "denied", reason: PersonaApprovalDenialReasons.Conflict });
	});

	it("rejects a persona with fewer than three explicit insights", async function ()
	{
		const approveAndActivateAtomically = vi.fn();
		const getApprovalSnapshot = vi.fn().mockResolvedValue(_Snapshot({ insightCount: 2 }));
		const result = await __ApprovePersona({ getApprovalSnapshot, approveAndActivateAtomically }, { personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-18T09:00:00.000Z" });
		expect(result).toEqual({ outcome: "denied", reason: "invalid_insights" });
		expect(approveAndActivateAtomically).not.toHaveBeenCalled();
	});

	it("rejects a persona whose template was not selected by its interview answers", async function ()
	{
		const approveAndActivateAtomically = vi.fn();
		const getApprovalSnapshot = vi.fn().mockResolvedValue(_Snapshot({ templateSelectionMatches: false }));
		const result = await __ApprovePersona({ getApprovalSnapshot, approveAndActivateAtomically }, { personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-18T09:00:00.000Z" });
		expect(result).toEqual({ outcome: "denied", reason: "template_selection_mismatch" });
		expect(approveAndActivateAtomically).not.toHaveBeenCalled();
	});
});
