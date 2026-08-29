import { SkillWorkloadKind } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { TOOL_RUNNER_PROJECTED_TOKEN_AUDIENCE, TOOL_RUNNER_SERVICE_ACCOUNT_NAME } from "@opencrane/contracts";

import { PrismaSkillWorkloadBootstrapRepository } from "../prisma-skill-workload-bootstrap-repository";

/** Worker identity used by the bootstrap tests below. */
const _IDENTITY = { namespace: "opencrane-tools", serviceAccountName: "tool-runner-default", podUid: "pod-uid-1" };

describe("Prisma skill workload bootstrap repository", function _DescribeBootstrapRepository()
{
	it("loads only a released tool-runner bootstrap with the fixed worker identity", async function _LoadsOnlyToolRunner()
	{
		const now = new Date("2099-07-26T05:00:01.000Z");
		const findFirst = vi.fn().mockResolvedValue({ skillWorkloadId: "workload-1", referenceHash: "sha256:reference", audience: TOOL_RUNNER_PROJECTED_TOKEN_AUDIENCE, serviceAccountName: TOOL_RUNNER_SERVICE_ACCOUNT_NAME, namespace: "opencrane-tools", workloadUid: "job-uid-1", skillWorkload: { workerPodUid: "pod-uid-1" } });
		const transaction = { skillAuthorityClock: { findUnique: vi.fn().mockResolvedValue({ singleton: 1, now }) }, skillWorkloadBootstrap: { findFirst } };
		const repository = new PrismaSkillWorkloadBootstrapRepository(transaction as never);

		await expect(repository.loadUnconsumed("sha256:reference")).resolves.toMatchObject({ workloadId: "workload-1", podUid: "pod-uid-1" });
		expect(findFirst).toHaveBeenCalledWith({ where: { referenceHash: "sha256:reference", audience: TOOL_RUNNER_PROJECTED_TOKEN_AUDIENCE, serviceAccountName: TOOL_RUNNER_SERVICE_ACCOUNT_NAME, consumedAt: null, expiresAt: { gt: now }, skillWorkload: { kind: SkillWorkloadKind.ToolRunner, releasedAt: { not: null }, workerPodUid: { not: null } } }, include: { skillWorkload: true } });
	});

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
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ audience: TOOL_RUNNER_PROJECTED_TOKEN_AUDIENCE, serviceAccountName: TOOL_RUNNER_SERVICE_ACCOUNT_NAME, skillWorkload: expect.objectContaining({ kind: SkillWorkloadKind.ToolRunner }) }) }));
	});
});
