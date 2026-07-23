import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaPersonaAuthorityRepository } from "../prisma-persona-authority-repository.js";

/** Build a narrow fake Prisma client for one persona approval authority test. */
function _Prisma(overrides: Record<string, unknown> = {}): PrismaClient
{
	const client: Record<string, unknown> = {
		personaRevision: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		personaProfile: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		personaInsight: { count: vi.fn().mockResolvedValue(3) },
		$queryRaw: vi.fn().mockResolvedValue([{ matches: true }]),
		...overrides,
	};
	client.$transaction = vi.fn(async function _transaction(callback: (transaction: unknown) => Promise<unknown>): Promise<unknown> { return callback(client); });
	return client as unknown as PrismaClient;
}

describe("PrismaPersonaAuthorityRepository", function _describePrismaPersonaAuthorityRepository()
{
	it("returns a complete approval snapshot with the database-selected template check", async function _returnsApprovalSnapshot()
	{
		const prisma = _Prisma({
			personaRevision: { findFirst: vi.fn().mockResolvedValue({ state: "Draft", personaProfileId: "profile-1", soulTemplateDigest: "sha256:template", durableSoulMutationPolicy: "forbidden", profile: { userId: "user-1" }, interview: { state: "Completed" }, soulTemplate: { digest: "sha256:template" }, _count: { insights: 3 } }), updateMany: vi.fn() },
		});
		const repository = new PrismaPersonaAuthorityRepository(prisma);

		await expect(repository.getApprovalSnapshot({ personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-23T12:00:00.000Z" })).resolves.toEqual({ profileUserId: "user-1", revisionState: "draft", revisionProfileId: "profile-1", interviewState: "completed", insightCount: 3, templateDigestMatches: true, templateSelectionMatches: true, durableSoulMutationPolicy: "forbidden" });
	});

	it("locks the owner profile before approving the draft and advancing its active pointer", async function _locksThenActivates()
	{
		const updateRevision = vi.fn().mockResolvedValue({ count: 1 });
		const updateProfile = vi.fn().mockResolvedValue({ count: 1 });
		const queryRaw = vi.fn().mockResolvedValue([{ id: "profile-1" }]);
		const prisma = _Prisma({ personaRevision: { findFirst: vi.fn(), updateMany: updateRevision }, personaProfile: { updateMany: updateProfile }, $queryRaw: queryRaw });
		const repository = new PrismaPersonaAuthorityRepository(prisma);

		await expect(repository.approveAndActivateAtomically({ personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-23T12:00:00.000Z", expectedRevisionState: "draft", expectedInterviewState: "completed", expectedInsightCount: 3 })).resolves.toEqual({ status: "approved" });
		expect(queryRaw).toHaveBeenCalledBefore(updateRevision);
		expect(updateRevision).toHaveBeenCalledBefore(updateProfile);
		expect(updateProfile).toHaveBeenCalledWith({ where: { id: "profile-1", userId: "user-1" }, data: { activeRevisionId: "revision-1" } });
	});

	it("does not update a draft when the locked profile is absent or belongs to another user", async function _rejectsMissingOwner()
	{
		const updateRevision = vi.fn();
		const prisma = _Prisma({ personaRevision: { findFirst: vi.fn(), updateMany: updateRevision }, $queryRaw: vi.fn().mockResolvedValue([]) });
		const repository = new PrismaPersonaAuthorityRepository(prisma);

		await expect(repository.approveAndActivateAtomically({ personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-23T12:00:00.000Z", expectedRevisionState: "draft", expectedInterviewState: "completed", expectedInsightCount: 3 })).resolves.toEqual({ status: "not_found" });
		expect(updateRevision).not.toHaveBeenCalled();
	});

	it("does not approve when the draft evidence changed after its preflight snapshot", async function _rejectsChangedEvidence()
	{
		const updateRevision = vi.fn();
		const prisma = _Prisma({ personaRevision: { findFirst: vi.fn(), updateMany: updateRevision }, personaInsight: { count: vi.fn().mockResolvedValue(4) }, $queryRaw: vi.fn().mockResolvedValue([{ id: "profile-1" }]) });
		const repository = new PrismaPersonaAuthorityRepository(prisma);

		await expect(repository.approveAndActivateAtomically({ personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-23T12:00:00.000Z", expectedRevisionState: "draft", expectedInterviewState: "completed", expectedInsightCount: 3 })).resolves.toEqual({ status: "conflict" });
		expect(updateRevision).not.toHaveBeenCalled();
	});
});
