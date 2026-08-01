import { describe, expect, it, vi } from "vitest";

import { __ApprovePersona } from "../persona-authority.js";

describe("persona authority", function ()
{
	it("approves only a complete immutable onboarding result", async function ()
	{
		const approveAndActivateAtomically = vi.fn().mockResolvedValue({ status: "approved" });
		const getApprovalSnapshot = vi.fn().mockResolvedValue({ profileUserId: "user-1", revisionState: "draft", revisionProfileId: "profile-1", interviewState: "completed", insightCount: 3, templateDigestMatches: true, templateSelectionMatches: true, durableSoulMutationPolicy: "forbidden" });
		const result = await __ApprovePersona({ getApprovalSnapshot, approveAndActivateAtomically }, { personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-18T09:00:00.000Z" });
		expect(result).toEqual({ outcome: "approved" });
		expect(approveAndActivateAtomically).toHaveBeenCalledWith(expect.objectContaining({ expectedInsightCount: 3 }));
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
