import { describe, expect, it, vi } from "vitest";

import { PrismaSkillAuthoringCompletionRepository } from "../prisma-skill-authoring-completion-repository.js";
import { SkillAuthoringCompletionOutcomes } from "../skill-authoring-completion.types.js";

/** Exact reviewed authoring worker identity used for persistence-boundary denial coverage. */
const _IDENTITY = { namespace: "opencrane-skill-authoring", serviceAccountName: "skill-authoring-default", podUid: "pod-uid-1" };

describe("Prisma skill authoring completion repository", function _DescribeCompletionRepository()
{
	it("fails closed before any revision evidence write when the workload lock is unavailable", async function _RejectsMissingWorkload()
	{
		const transaction = { $queryRaw: vi.fn().mockResolvedValue([]), skillWorkload: { findFirst: vi.fn() }, skillRevision: { updateMany: vi.fn() } };
		const repository = new PrismaSkillAuthoringCompletionRepository(transaction as never);

		await expect(repository.complete({ workloadId: "workload-1", outcome: SkillAuthoringCompletionOutcomes.Failed, failureCode: "worker_failed" }, _IDENTITY)).resolves.toBe("conflict");
		expect(transaction.skillWorkload.findFirst).not.toHaveBeenCalled();
		expect(transaction.skillRevision.updateMany).not.toHaveBeenCalled();
	});
});
