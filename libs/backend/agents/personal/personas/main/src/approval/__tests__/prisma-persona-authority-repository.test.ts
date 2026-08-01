import type { PrismaClient } from "@prisma/client";
import type { PersonalConfigurationPersonaRefreshUnitOfWork } from "@opencrane/backend/agents/personal/configuration";
import { describe, expect, it, vi } from "vitest";

import { PrismaPersonaAuthorityRepository } from "../prisma-persona-authority-repository.js";
import { PersonaApprovalPersistenceStatuses } from "../persona-authority.types.js";

/** Build a narrow fake Prisma client for one persona approval authority test. */
function _Prisma(overrides: Record<string, unknown> = {}): PrismaClient
{
	const client: Record<string, unknown> = {
		personaRevision: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		personaProfile: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		personaInsight: { count: vi.fn().mockResolvedValue(3) },
		personaInterview: { findUnique: vi.fn().mockResolvedValue({ refreshConfigurationChangeId: null }) },
		$queryRaw: vi.fn().mockResolvedValue([{ matches: true }]),
		...overrides,
	};
	client.$transaction = vi.fn(async function _transaction(callback: (transaction: unknown) => Promise<unknown>): Promise<unknown> { return callback(client); });
	return client as unknown as PrismaClient;
}

/** Runs approval work against one fake Prisma transaction and configuration-owned refresh port. */
function _Refreshes(transaction: unknown, apply = vi.fn(async function _apply() { return true; })): PersonalConfigurationPersonaRefreshUnitOfWork
{
	return {
		runPersonaRefresh: async function _run(work)
		{
			return work(transaction as never, {
				claimAcceptedPersonaRefresh: async function _claim() { throw new Error("approval does not claim refreshes"); },
				applyApprovedPersonaRefresh: apply,
			});
		},
	};
}

describe("PrismaPersonaAuthorityRepository", function _describePrismaPersonaAuthorityRepository()
{
	it("returns a complete approval snapshot with the database-selected template check", async function _returnsApprovalSnapshot()
	{
		const prisma = _Prisma({
			personaRevision: { findFirst: vi.fn().mockResolvedValue({ state: "Draft", personaProfileId: "profile-1", soulTemplateDigest: "sha256:template", durableSoulMutationPolicy: "forbidden", profile: { userId: "user-1" }, interview: { state: "Completed" }, soulTemplate: { digest: "sha256:template" }, _count: { insights: 3 } }), updateMany: vi.fn() },
		});
		const repository = new PrismaPersonaAuthorityRepository(prisma, _Refreshes(prisma));

		await expect(repository.getApprovalSnapshot({ personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-23T12:00:00.000Z" })).resolves.toEqual({ profileUserId: "user-1", revisionState: "draft", revisionProfileId: "profile-1", interviewState: "completed", insightCount: 3, templateDigestMatches: true, templateSelectionMatches: true, durableSoulMutationPolicy: "forbidden" });
	});

	it("locks the owner profile before approving the draft and advancing its active pointer", async function _locksThenActivates()
	{
		const updateRevision = vi.fn().mockResolvedValue({ count: 1 });
		const updateProfile = vi.fn().mockResolvedValue({ count: 1 });
		const queryRaw = vi.fn().mockResolvedValue([{ id: "profile-1", siloId: "silo-1" }]);
		const prisma = _Prisma({ personaRevision: { findFirst: vi.fn(), updateMany: updateRevision }, personaProfile: { updateMany: updateProfile }, $queryRaw: queryRaw });
		const repository = new PrismaPersonaAuthorityRepository(prisma, _Refreshes(prisma));

		await expect(repository.approveAndActivateAtomically({ personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-23T12:00:00.000Z", expectedRevisionState: "draft", expectedInterviewState: "completed", expectedInsightCount: 3 })).resolves.toEqual({ status: PersonaApprovalPersistenceStatuses.Approved });
		expect(queryRaw).toHaveBeenCalledBefore(updateRevision);
		expect(updateRevision).toHaveBeenCalledBefore(updateProfile);
		expect(updateProfile).toHaveBeenCalledWith({ where: { id: "profile-1", userId: "user-1" }, data: { activeRevisionId: "revision-1" } });
	});

	it("does not update a draft when the locked profile is absent or belongs to another user", async function _rejectsMissingOwner()
	{
		const updateRevision = vi.fn();
		const prisma = _Prisma({ personaRevision: { findFirst: vi.fn(), updateMany: updateRevision }, $queryRaw: vi.fn().mockResolvedValue([]) });
		const repository = new PrismaPersonaAuthorityRepository(prisma, _Refreshes(prisma));

		await expect(repository.approveAndActivateAtomically({ personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-23T12:00:00.000Z", expectedRevisionState: "draft", expectedInterviewState: "completed", expectedInsightCount: 3 })).resolves.toEqual({ status: PersonaApprovalPersistenceStatuses.NotFound });
		expect(updateRevision).not.toHaveBeenCalled();
	});

	it("applies only the accepted refresh proposal bound to the approved revision interview", async function _appliesBoundRefresh()
	{
		const applyChange = vi.fn(async function _apply() { return true; });
		const queryRaw = vi.fn().mockResolvedValueOnce([{ id: "profile-1", siloId: "silo-1" }]).mockResolvedValueOnce([{ id: "revision-1", interviewId: "interview-1" }]);
		const prisma = _Prisma({
			personaInterview: { findUnique: vi.fn().mockResolvedValue({ refreshConfigurationChangeId: "change-1" }) },
			$queryRaw: queryRaw,
		});
		const repository = new PrismaPersonaAuthorityRepository(prisma, _Refreshes(prisma, applyChange));

		await expect(repository.approveAndActivateAtomically({ personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-23T12:00:00.000Z", expectedRevisionState: "draft", expectedInterviewState: "completed", expectedInsightCount: 3 })).resolves.toEqual({ status: PersonaApprovalPersistenceStatuses.Approved });
		expect(applyChange).toHaveBeenCalledWith({ configurationChangeId: "change-1", siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1", personaRevisionId: "revision-1" });
	});

	it("does not approve when the draft evidence changed after its preflight snapshot", async function _rejectsChangedEvidence()
	{
		const updateRevision = vi.fn();
		const prisma = _Prisma({ personaRevision: { findFirst: vi.fn(), updateMany: updateRevision }, personaInsight: { count: vi.fn().mockResolvedValue(4) }, $queryRaw: vi.fn().mockResolvedValue([{ id: "profile-1", siloId: "silo-1" }]) });
		const repository = new PrismaPersonaAuthorityRepository(prisma, _Refreshes(prisma));

		await expect(repository.approveAndActivateAtomically({ personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-23T12:00:00.000Z", expectedRevisionState: "draft", expectedInterviewState: "completed", expectedInsightCount: 3 })).resolves.toEqual({ status: PersonaApprovalPersistenceStatuses.Conflict });
		expect(updateRevision).not.toHaveBeenCalled();
	});

	it("rejects a disappeared interview before changing its draft or active persona pointer", async function _rejectsMissingInterview()
	{
		const updateRevision = vi.fn();
		const updateProfile = vi.fn();
		const queryRaw = vi.fn().mockResolvedValueOnce([{ id: "profile-1", siloId: "silo-1" }]).mockResolvedValueOnce([{ id: "revision-1", interviewId: "interview-missing" }]);
		const prisma = _Prisma({ personaRevision: { findFirst: vi.fn(), updateMany: updateRevision }, personaProfile: { updateMany: updateProfile }, personaInterview: { findUnique: vi.fn().mockResolvedValue(null) }, $queryRaw: queryRaw });
		const repository = new PrismaPersonaAuthorityRepository(prisma, _Refreshes(prisma));

		await expect(repository.approveAndActivateAtomically({ personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-23T12:00:00.000Z", expectedRevisionState: "draft", expectedInterviewState: "completed", expectedInsightCount: 3 })).resolves.toEqual({ status: PersonaApprovalPersistenceStatuses.Conflict });
		expect(updateRevision).not.toHaveBeenCalled();
		expect(updateProfile).not.toHaveBeenCalled();
	});
});
