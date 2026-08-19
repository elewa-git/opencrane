import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PersonaApprovalTransactionConflict, PrismaPersonaAuthorityRepository } from "../prisma-persona-authority-repository";
import { PersonaAgentRevisionSelectionStatuses, PersonaApprovalInterviewStates, PersonaApprovalPersistenceStatuses, PersonaApprovalRevisionStates, type PersonaAgentRevisionSelectionPort } from "../persona-authority.types";

/** Build a narrow fake Prisma client for one persona approval authority test. */
function _Prisma(overrides: Record<string, unknown> = {}): Prisma.TransactionClient
{
	const client: Record<string, unknown> = {
		personaRevision: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		personaProfile: { findFirst: vi.fn().mockResolvedValue({ siloId: "silo-1", activeRevisionId: null }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		personaInsight: { count: vi.fn().mockResolvedValue(3) },
		personaInterview: { findUnique: vi.fn().mockResolvedValue({ refreshConfigurationChangeId: null }), findFirst: vi.fn().mockResolvedValue(null) },
		personaInterviewScore: { findUnique: vi.fn().mockResolvedValue(null) },
		personaTieResolution: { findMany: vi.fn().mockResolvedValue([]) },
		personaInterviewAnswer: { findMany: vi.fn().mockResolvedValue([]) },
		personalConfigurationChange: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		...overrides,
	};
	return client as unknown as Prisma.TransactionClient;
}

/** Construct the authority with the real aggregate read adapter over the narrow fake transaction. */
function _Repository(prisma: Prisma.TransactionClient, selection: PersonaAgentRevisionSelectionPort = _Selection()): PrismaPersonaAuthorityRepository
{
	return new PrismaPersonaAuthorityRepository(prisma, selection);
}

/** Builds the cross-domain selection port used by approval tests. */
function _Selection(select = vi.fn().mockResolvedValue({ status: PersonaAgentRevisionSelectionStatuses.Selected })): PersonaAgentRevisionSelectionPort
{
	return { select };
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
		const score = { orderedAnswerIds: ["answer-1"], orderedChoiceIds: ["q1:a"], colours: { red: 2, yellow: 0, green: 0, blue: 1, total: 3 }, openness: { explorer: 1, guardian: 0, total: 1 }, tieResolutions: [], primary: "red", secondary: "blue", modifier: "explorer" };
		const prisma = _Prisma({
			personaRevision: { findFirst: vi.fn().mockResolvedValue({ state: "Draft", personaProfileId: "profile-1", soulTemplateId: "template", soulTemplateVersion: 1, soulTemplateDigest: "sha256:template", durableSoulMutationPolicy: "forbidden", profile: { userId: "user-1", activeRevisionId: null }, interview: { id: "interview-1", state: "Completed", scoringPolicyId: "policy", scoringPolicyVersion: 1, scoringPolicy: { digest: "sha256:policy" }, interpolationMapId: "map", interpolationMapVersion: 1 }, soulTemplate: { digest: "sha256:template", primaryColour: "Red", modifier: "Explorer" }, _count: { insights: 3 }, scoringPolicyId: "policy", scoringPolicyVersion: 1, scoringPolicyDigest: "sha256:policy", interpolationMapId: "map", interpolationMapVersion: 1, interpolationMapDigest: "sha256:map", interpolationMap: { digest: "sha256:map" }, primaryColour: "Red", secondaryColour: "Blue", modifier: "Explorer", scoringEvidence: score }), updateMany: vi.fn() },
			personaInterview: { findUnique: vi.fn(), findFirst: vi.fn().mockResolvedValue({ scoringPolicyId: "policy", scoringPolicyVersion: 1, scoringPolicy: { digest: "sha256:policy" } }) },
			personaInterviewAnswer: { findMany: vi.fn().mockResolvedValue([{ id: "answer-1", questionId: "q1", choiceId: "a", choice: { question: { ordinal: 1 }, weights: [{ red: 2, yellow: 0, green: 0, blue: 1, explorer: 1, guardian: 0 }] } }]) },
			personaInterviewScore: { findUnique: vi.fn().mockResolvedValue({ scoringPolicyId: "policy", scoringPolicyVersion: 1, scoringPolicyDigest: "sha256:policy", orderedAnswerIds: ["answer-1"], orderedChoiceIds: ["q1:a"], red: 2, yellow: 0, green: 0, blue: 1, colourTotal: 3, explorer: 1, guardian: 0, opennessTotal: 1, primaryCandidates: ["Red"], secondaryCandidates: ["Blue"], modifierCandidates: ["Explorer"] }) },
			personaTieResolution: { findMany: vi.fn().mockResolvedValue([]) },
		});
		const repository = _Repository(prisma);

		await expect(repository.getApprovalSnapshot({ personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-23T12:00:00.000Z" })).resolves.toEqual({ profileUserId: "user-1", activeRevisionId: null, revisionState: "draft", revisionProfileId: "profile-1", interviewState: "completed", insightCount: 3, templateDigestMatches: true, templateSelectionMatches: true, durableSoulMutationPolicy: "forbidden" });
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
		const select = vi.fn().mockResolvedValue({ status: PersonaAgentRevisionSelectionStatuses.Selected });
		const updateProfile = vi.fn().mockResolvedValue({ count: 1 });
		const prisma = _Prisma({
			personaRevision: _DraftRevision(),
			personaProfile: { findFirst: vi.fn().mockResolvedValue({ siloId: "silo-1", activeRevisionId: "persona-old" }), updateMany: updateProfile },
			personaInterview: { findUnique: vi.fn().mockResolvedValue({ refreshConfigurationChangeId: "change-1" }) },
			personalConfigurationChange: { updateMany: applyChange },
		});
		const repository = _Repository(prisma, _Selection(select));

		await expect(repository.approveAndActivateAtomically({ personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-23T12:00:00.000Z", expectedRevisionState: PersonaApprovalRevisionStates.Draft, expectedInterviewState: PersonaApprovalInterviewStates.Completed, expectedInsightCount: 3 })).resolves.toEqual({ status: PersonaApprovalPersistenceStatuses.Approved });
		expect(select).toHaveBeenCalledWith({ siloId: "silo-1", userId: "user-1", personaRevisionId: "revision-1", selectedAt: new Date("2026-07-23T12:00:00.000Z") });
		expect(select).toHaveBeenCalledBefore(updateProfile);
		expect(updateProfile).toHaveBeenCalledBefore(applyChange);
		expect(applyChange).toHaveBeenCalledWith({ where: expect.objectContaining({ id: "change-1", siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1" }), data: { state: "Applied", appliedPersonaRevisionId: "revision-1" } });
	});

	it("does not invoke agent revision selection for initial persona approval", async function _KeepsInitialApprovalIndependent()
	{
		const select = vi.fn();
		const repository = _Repository(_Prisma({ personaRevision: _DraftRevision() }), _Selection(select));

		await expect(repository.approveAndActivateAtomically({ personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-23T12:00:00.000Z", expectedRevisionState: PersonaApprovalRevisionStates.Draft, expectedInterviewState: PersonaApprovalInterviewStates.Completed, expectedInsightCount: 3 })).resolves.toEqual({ status: PersonaApprovalPersistenceStatuses.Approved });
		expect(select).not.toHaveBeenCalled();
	});

	it("rolls refresh approval back when agent-service selection fails closed", async function _RejectsAgentSelectionConflict()
	{
		const updateProfile = vi.fn();
		const applyChange = vi.fn();
		const prisma = _Prisma({
			personaRevision: _DraftRevision(),
			personaProfile: { findFirst: vi.fn().mockResolvedValue({ siloId: "silo-1", activeRevisionId: "persona-old" }), updateMany: updateProfile },
			personaInterview: { findUnique: vi.fn().mockResolvedValue({ refreshConfigurationChangeId: "change-1" }) },
			personalConfigurationChange: { updateMany: applyChange },
		});
		const repository = _Repository(prisma, _Selection(vi.fn().mockResolvedValue({ status: PersonaAgentRevisionSelectionStatuses.Conflict })));

		await expect(repository.approveAndActivateAtomically({ personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-23T12:00:00.000Z", expectedRevisionState: PersonaApprovalRevisionStates.Draft, expectedInterviewState: PersonaApprovalInterviewStates.Completed, expectedInsightCount: 3 })).rejects.toBeInstanceOf(PersonaApprovalTransactionConflict);
		expect(updateProfile).not.toHaveBeenCalled();
		expect(applyChange).not.toHaveBeenCalled();
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
