import { describe, expect, it, vi } from "vitest";

import { PrismaSkillWorkloadBootstrapRepository } from "../prisma-skill-workload-bootstrap-repository.js";

/** Worker identity used by the bootstrap tests below. */
const _IDENTITY = { namespace: "opencrane-skill-authoring", serviceAccountName: "skill-authoring-default", podUid: "pod-uid-1" };

describe("Prisma skill workload bootstrap repository", function _DescribeBootstrapRepository()
{
	it("uses database time for expiry and asks the trigger to own consumption time", async function _ConsumesWithDatabaseTime()
	{
		const now = new Date("2099-07-26T05:00:01.000Z");
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { skillAuthorityClock: { findUnique: vi.fn().mockResolvedValue({ singleton: 1, now }) }, skillWorkloadBootstrap: { updateMany } };
		const repository = new PrismaSkillWorkloadBootstrapRepository(transaction as never);

		await expect(repository.consume("sha256:reference", _IDENTITY)).resolves.toBe("consumed");
		const mutation = updateMany.mock.calls[0]?.[0] as { readonly where?: { readonly expiresAt?: { readonly gt?: Date } }; readonly data?: { readonly consumedAt?: Date; readonly consumedByPodUid?: string } } | undefined;
		expect(mutation?.where?.expiresAt?.gt).toBe(now);
		expect(mutation?.data?.consumedAt?.getTime()).toBe(0);
		expect(mutation?.data?.consumedByPodUid).toBe(_IDENTITY.podUid);
	});
});
