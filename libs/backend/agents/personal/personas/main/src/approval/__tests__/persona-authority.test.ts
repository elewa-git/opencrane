import { describe, expect, it, vi } from "vitest";

import { __ApprovePersona } from "../persona-authority.js";
import { PersonaApprovalDenialReasons, PersonaApprovalPersistenceStatuses } from "../persona-authority.types.js";

describe("persona authority", function ()
{
	it("approves only a complete immutable onboarding result", async function ()
	{
		const approveAndActivateAtomically = vi.fn().mockResolvedValue({ status: PersonaApprovalPersistenceStatuses.Approved });
		const getApprovalSnapshot = vi.fn().mockResolvedValue({ profileUserId: "user-1", revisionState: "draft", revisionProfileId: "profile-1", interviewState: "completed", insightCount: 3, templateDigestMatches: true, templateSelectionMatches: true, durableSoulMutationPolicy: "forbidden" });
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
		const getApprovalSnapshot = vi.fn().mockResolvedValue({ profileUserId: "user-1", revisionState: "draft", revisionProfileId: "profile-1", interviewState: "completed", insightCount: 3, templateDigestMatches: true, templateSelectionMatches: true, durableSoulMutationPolicy: "forbidden" });
		const command = { personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-18T09:00:00.000Z" };

		const outcomes = await Promise.all([__ApprovePersona({ getApprovalSnapshot, approveAndActivateAtomically }, command), __ApprovePersona({ getApprovalSnapshot, approveAndActivateAtomically }, command)]);

		expect(outcomes).toEqual([{ outcome: "approved" }, { outcome: "denied", reason: PersonaApprovalDenialReasons.Conflict }]);
		expect(approveAndActivateAtomically).toHaveBeenCalledTimes(2);
	});

	it("rejects a persona with fewer than three explicit insights", async function ()
	{
		const approveAndActivateAtomically = vi.fn();
		const getApprovalSnapshot = vi.fn().mockResolvedValue({ profileUserId: "user-1", revisionState: "draft", revisionProfileId: "profile-1", interviewState: "completed", insightCount: 2, templateDigestMatches: true, templateSelectionMatches: true, durableSoulMutationPolicy: "forbidden" });
		const result = await __ApprovePersona({ getApprovalSnapshot, approveAndActivateAtomically }, { personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-18T09:00:00.000Z" });
		expect(result).toEqual({ outcome: "denied", reason: "invalid_insights" });
		expect(approveAndActivateAtomically).not.toHaveBeenCalled();
	});

	it("rejects a persona whose template was not selected by its interview answers", async function ()
	{
		const approveAndActivateAtomically = vi.fn();
		const getApprovalSnapshot = vi.fn().mockResolvedValue({ profileUserId: "user-1", revisionState: "draft", revisionProfileId: "profile-1", interviewState: "completed", insightCount: 3, templateDigestMatches: true, templateSelectionMatches: false, durableSoulMutationPolicy: "forbidden" });
		const result = await __ApprovePersona({ getApprovalSnapshot, approveAndActivateAtomically }, { personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-18T09:00:00.000Z" });
		expect(result).toEqual({ outcome: "denied", reason: "template_selection_mismatch" });
		expect(approveAndActivateAtomically).not.toHaveBeenCalled();
	});
});
