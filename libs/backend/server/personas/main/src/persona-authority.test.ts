import { describe, expect, it, vi } from "vitest";

import { __ApprovePersona } from "./persona-authority.js";
import { PrismaPersonaAuthorityRepository } from "./prisma-persona-authority.js";

/** Builds one transaction double with an otherwise-valid completed onboarding record. */
function _Transaction(overrides: { readonly revisionState?: "draft" | "approved"; readonly candidateRuleId?: string; readonly insightCount?: number } = {})
{
	const transaction = {
		$queryRaw: vi.fn()
			.mockResolvedValueOnce([{ id: "profile-1", userId: "user-1" }])
			.mockResolvedValueOnce([{ id: "revision-1", personaProfileId: "profile-1", state: overrides.revisionState ?? "draft", interviewId: "interview-1", soulTemplateId: "template-1", soulTemplateVersion: 1, soulTemplateDigest: "sha256:template", selectionRuleId: "rule-1", selectionAnswerIds: ["answer-1"], durableSoulMutationPolicy: "forbidden" }])
			.mockResolvedValueOnce([{ state: "completed" }])
			.mockResolvedValueOnce([{ templateId: "template-1", templateVersion: 1, templateDigest: "sha256:template", ruleId: overrides.candidateRuleId ?? "rule-1", answerIds: ["answer-1"] }]),
		personaInsight: { count: vi.fn().mockResolvedValue(overrides.insightCount ?? 3) },
		personaRevision: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		personaProfile: { update: vi.fn().mockResolvedValue({}) },
	};
	return transaction;
}

/** Wraps one transaction double in the Prisma transaction callback contract. */
function _Prisma(transaction: ReturnType<typeof _Transaction>)
{
	return { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as never;
}

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

	it("loads complete evidence under profile, revision, and interview locks", async function _snapshot()
	{
		const transaction = _Transaction();
		const result = await new PrismaPersonaAuthorityRepository(_Prisma(transaction)).getApprovalSnapshot({ personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-18T09:00:00.000Z" });
		expect(result).toMatchObject({ profileUserId: "user-1", revisionProfileId: "profile-1", interviewState: "completed", templateDigestMatches: true, templateSelectionMatches: true });
		expect(transaction.$queryRaw).toHaveBeenCalledTimes(4);
	});

	it("rejects an atomically re-read revision when its selected rule changed", async function _staleSelection()
	{
		const transaction = _Transaction({ candidateRuleId: "other-rule" });
		const result = await new PrismaPersonaAuthorityRepository(_Prisma(transaction)).approveAndActivateAtomically({ personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-18T09:00:00.000Z", expectedRevisionState: "draft", expectedInterviewState: "completed", expectedInsightCount: 3 });
		expect(result).toEqual({ status: "conflict" });
		expect(transaction.personaRevision.updateMany).not.toHaveBeenCalled();
		expect(transaction.personaProfile.update).not.toHaveBeenCalled();
	});

	it("approves the exact draft before advancing its locked profile pointer", async function _atomicApproval()
	{
		const transaction = _Transaction();
		const result = await new PrismaPersonaAuthorityRepository(_Prisma(transaction)).approveAndActivateAtomically({ personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-18T09:00:00.000Z", expectedRevisionState: "draft", expectedInterviewState: "completed", expectedInsightCount: 3 });
		expect(result).toEqual({ status: "approved" });
		expect(transaction.personaRevision.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "revision-1", personaProfileId: "profile-1" }) }));
		expect(transaction.personaProfile.update).toHaveBeenCalledWith({ where: { id: "profile-1" }, data: { activeRevisionId: "revision-1" } });
	});
});
