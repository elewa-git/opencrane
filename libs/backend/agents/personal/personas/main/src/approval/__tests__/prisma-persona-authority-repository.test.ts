import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaPersonaAuthorityRepository } from "../prisma-persona-authority-repository.js";
import { PersonaApprovalInterviewStates, PersonaApprovalPersistenceStatuses, PersonaApprovalRevisionStates } from "../persona-authority.types.js";

/** Build a narrow fake Prisma client for one persona approval authority test. */
function _Prisma(overrides: Record<string, unknown> = {}): Prisma.TransactionClient
{
	const client: Record<string, unknown> = {
		personaRevision: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		personaProfile: { findFirst: vi.fn().mockResolvedValue({ siloId: "silo-1", activeRevisionId: null }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		personaInsight: { count: vi.fn().mockResolvedValue(3) },
		personaInterview: { findUnique: vi.fn().mockResolvedValue({ refreshConfigurationChangeId: null }) },
		personaSoulTemplate: { findMany: vi.fn().mockResolvedValue([{ id: "template", version: 1, digest: "sha256:template", content: "# Template", selectionRules: [{ id: "rule-1", priority: 1, answers: {} }] }]) },
		personaInterviewAnswer: { findMany: vi.fn().mockResolvedValue([]) },
		personalConfigurationChange: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		...overrides,
	};
	return client as unknown as Prisma.TransactionClient;
}

/** Construct the authority with the real aggregate read adapter over the narrow fake transaction. */
function _Repository(prisma: Prisma.TransactionClient): PrismaPersonaAuthorityRepository
{
	return new PrismaPersonaAuthorityRepository(prisma);
}

/** Build the still-draft revision evidence returned by the aggregate read adapter. */
function _DraftRevision(interviewId = "interview-1"): { findFirst: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> }
{
	return { findFirst: vi.fn().mockResolvedValue({ interviewId }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) };
}

describe("PrismaPersonaAuthorityRepository", function _describePrismaPersonaAuthorityRepository()
{
	it("returns a complete approval snapshot with the database-selected template check", async function _returnsApprovalSnapshot()
	{
		const prisma = _Prisma({
			personaRevision: { findFirst: vi.fn().mockResolvedValue({ state: "Draft", personaProfileId: "profile-1", soulTemplateId: "template", soulTemplateVersion: 1, selectionRuleId: "rule-1", selectionAnswerIds: [], soulTemplateDigest: "sha256:template", durableSoulMutationPolicy: "forbidden", profile: { userId: "user-1" }, interview: { id: "interview-1", state: "Completed" }, soulTemplate: { digest: "sha256:template" }, _count: { insights: 3 } }), updateMany: vi.fn() },
		});
		const repository = _Repository(prisma);

		await expect(repository.getApprovalSnapshot({ personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-23T12:00:00.000Z" })).resolves.toEqual({ profileUserId: "user-1", revisionState: "draft", revisionProfileId: "profile-1", interviewState: "completed", insightCount: 3, templateDigestMatches: true, templateSelectionMatches: true, durableSoulMutationPolicy: "forbidden" });
	});

	it("reads the owner profile before approving the draft and advancing its active pointer", async function _readsThenActivates()
	{
		const revisionReads = _DraftRevision();
		const updateProfile = vi.fn().mockResolvedValue({ count: 1 });
		const profileFind = vi.fn().mockResolvedValue({ siloId: "silo-1", activeRevisionId: null });
		const prisma = _Prisma({ personaRevision: revisionReads, personaProfile: { findFirst: profileFind, updateMany: updateProfile } });
		const repository = _Repository(prisma);

		await expect(repository.approveAndActivateAtomically({ personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-23T12:00:00.000Z", expectedRevisionState: PersonaApprovalRevisionStates.Draft, expectedInterviewState: PersonaApprovalInterviewStates.Completed, expectedInsightCount: 3 })).resolves.toEqual({ status: PersonaApprovalPersistenceStatuses.Approved });
		expect(profileFind).toHaveBeenCalledBefore(revisionReads.updateMany);
		expect(revisionReads.updateMany).toHaveBeenCalledBefore(updateProfile);
		expect(updateProfile).toHaveBeenCalledWith({ where: { id: "profile-1", userId: "user-1" }, data: { activeRevisionId: "revision-1" } });
	});

	it("does not update a draft when the owner profile is absent or belongs to another user", async function _rejectsMissingOwner()
	{
		const updateRevision = vi.fn();
		const prisma = _Prisma({ personaRevision: { findFirst: vi.fn(), updateMany: updateRevision }, personaProfile: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn() } });
		const repository = _Repository(prisma);

		await expect(repository.approveAndActivateAtomically({ personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-23T12:00:00.000Z", expectedRevisionState: PersonaApprovalRevisionStates.Draft, expectedInterviewState: PersonaApprovalInterviewStates.Completed, expectedInsightCount: 3 })).resolves.toEqual({ status: PersonaApprovalPersistenceStatuses.NotFound });
		expect(updateRevision).not.toHaveBeenCalled();
	});

	it("applies only the accepted refresh proposal bound to the approved revision interview", async function _appliesBoundRefresh()
	{
		const applyChange = vi.fn().mockResolvedValue({ count: 1 });
		const prisma = _Prisma({
			personaRevision: _DraftRevision(),
			personaInterview: { findUnique: vi.fn().mockResolvedValue({ refreshConfigurationChangeId: "change-1" }) },
			personalConfigurationChange: { updateMany: applyChange },
		});
		const repository = _Repository(prisma);

		await expect(repository.approveAndActivateAtomically({ personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-23T12:00:00.000Z", expectedRevisionState: PersonaApprovalRevisionStates.Draft, expectedInterviewState: PersonaApprovalInterviewStates.Completed, expectedInsightCount: 3 })).resolves.toEqual({ status: PersonaApprovalPersistenceStatuses.Approved });
		expect(applyChange).toHaveBeenCalledWith({ where: expect.objectContaining({ id: "change-1", siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1" }), data: { state: "Applied", appliedPersonaRevisionId: "revision-1" } });
	});

	it("does not approve when the draft evidence changed after its preflight snapshot", async function _rejectsChangedEvidence()
	{
		const revisionReads = _DraftRevision();
		const prisma = _Prisma({ personaRevision: revisionReads, personaInsight: { count: vi.fn().mockResolvedValue(4) } });
		const repository = _Repository(prisma);

		await expect(repository.approveAndActivateAtomically({ personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-23T12:00:00.000Z", expectedRevisionState: PersonaApprovalRevisionStates.Draft, expectedInterviewState: PersonaApprovalInterviewStates.Completed, expectedInsightCount: 3 })).resolves.toEqual({ status: PersonaApprovalPersistenceStatuses.Conflict });
		expect(revisionReads.updateMany).not.toHaveBeenCalled();
	});

	it("rejects a disappeared interview before changing its draft or active persona pointer", async function _rejectsMissingInterview()
	{
		const revisionReads = _DraftRevision("interview-missing");
		const updateProfile = vi.fn();
		const prisma = _Prisma({ personaRevision: revisionReads, personaProfile: { findFirst: vi.fn().mockResolvedValue({ siloId: "silo-1", activeRevisionId: null }), updateMany: updateProfile }, personaInterview: { findUnique: vi.fn().mockResolvedValue(null) } });
		const repository = _Repository(prisma);

		await expect(repository.approveAndActivateAtomically({ personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-23T12:00:00.000Z", expectedRevisionState: PersonaApprovalRevisionStates.Draft, expectedInterviewState: PersonaApprovalInterviewStates.Completed, expectedInsightCount: 3 })).resolves.toEqual({ status: PersonaApprovalPersistenceStatuses.Conflict });
		expect(revisionReads.updateMany).not.toHaveBeenCalled();
		expect(updateProfile).not.toHaveBeenCalled();
	});
});
