import { describe, expect, it, vi } from "vitest";

import { PrismaSkillWorkloadReleaseRepository } from "../prisma-skill-workload-release-repository";

describe("Prisma skill workload release repository", function _DescribeReleaseRepository()
{
	it("returns the database-owned timestamps written by the release-claim trigger", async function _ClaimsWithTriggerTimestamps()
	{
		const updateManyAndReturn = vi.fn().mockResolvedValue([{ releaseClaimedAt: new Date("2099-07-26T05:00:01.000Z"), releaseExpiresAt: new Date("2099-07-26T05:00:31.000Z") }]);
		const transaction = {
			skillWorkloadReleaseClaimCandidate: { findFirst: vi.fn().mockResolvedValue({ id: "workload-1" }) },
			skillWorkload: { findUnique: vi.fn().mockResolvedValue({ id: "workload-1", siloId: "silo-1", kind: "Authoring", state: "Assigned", workloadUid: "job-uid-1", releasedAt: null, releaseClaimedAt: null, releaseDeliveryCount: 0, releaseExpiresAt: null, bootstrap: { consumedAt: null, expiresAt: new Date("2099-07-26T05:15:00.000Z") } }), updateManyAndReturn },
		};
		const repository = new PrismaSkillWorkloadReleaseRepository(transaction as never, 30_000);

		await expect(repository.claimNextRelease()).resolves.toEqual({ workloadId: "workload-1", siloId: "silo-1", kind: "authoring", workloadUid: "job-uid-1", releaseClaimedAt: "2099-07-26T05:00:01.000Z", releaseDeliveryCount: 1, expiresAt: "2099-07-26T05:00:31.000Z" });
		const mutation = updateManyAndReturn.mock.calls[0]?.[0] as { readonly data?: { readonly releaseClaimedAt?: Date; readonly releaseExpiresAt?: Date } } | undefined;
		expect(mutation?.data?.releaseClaimedAt?.getTime()).toBe(0);
		expect((mutation?.data?.releaseExpiresAt?.getTime() ?? 0) - (mutation?.data?.releaseClaimedAt?.getTime() ?? 0)).toBe(30_000);
	});

	it("commits an exact release with database expiry and a trigger-owned timestamp", async function _CommitsWithDatabaseTime()
	{
		const releaseClaimedAt = new Date("2099-07-26T05:00:01.000Z");
		const now = new Date("2099-07-26T05:00:02.000Z");
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = {
			skillAuthorityClock: { findUnique: vi.fn().mockResolvedValue({ singleton: 1, now }) },
			skillWorkload: { findUnique: vi.fn().mockResolvedValue({ id: "workload-1", state: "Assigned", workloadUid: "job-uid-1", releasedAt: null, releaseClaimedAt, releaseDeliveryCount: 1, releaseExpiresAt: new Date("2099-07-26T05:00:31.000Z"), bootstrap: { consumedAt: null, expiresAt: new Date("2099-07-26T05:15:00.000Z") } }), updateMany },
		};
		const repository = new PrismaSkillWorkloadReleaseRepository(transaction as never, 30_000);

		await expect(repository.commitRelease("workload-1", { workloadUid: "job-uid-1", releaseClaimedAt: releaseClaimedAt.toISOString(), releaseDeliveryCount: 1 })).resolves.toBe("released");
		const mutation = updateMany.mock.calls[0]?.[0] as { readonly where?: { readonly bootstrap?: { readonly is?: { readonly expiresAt?: { readonly gt?: Date } } } }; readonly data?: { readonly releasedAt?: Date } } | undefined;
		expect(mutation?.where?.bootstrap?.is?.expiresAt?.gt).toBe(now);
		expect(mutation?.data?.releasedAt?.getTime()).toBe(0);
	});
});
