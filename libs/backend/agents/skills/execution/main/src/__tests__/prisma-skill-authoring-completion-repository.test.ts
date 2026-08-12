import { describe, expect, it, vi } from "vitest";

import { PrismaSkillAuthoringCompletionRepository } from "../prisma-skill-authoring-completion-repository.js";
import { SkillAuthoringCompletionOutcomes } from "../skill-authoring-completion.types.js";
import { _SkillWorkloadPersistenceConflictError } from "../skill-workload-unit-of-work.types.js";

/** Authoring worker identity used by the denial tests below. */
const _IDENTITY = { namespace: "opencrane-skill-authoring", serviceAccountName: "skill-authoring-default", podUid: "pod-uid-1" };

describe("Prisma skill authoring completion repository", function _DescribeCompletionRepository()
{
	it("fails closed before any revision evidence write when the workload fence is unavailable", async function _RejectsMissingWorkload()
	{
		const transaction = { skillWorkload: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn() }, skillRevision: { updateMany: vi.fn() } };
		const repository = new PrismaSkillAuthoringCompletionRepository(transaction as never);

		await expect(repository.complete({ workloadId: "workload-1", outcome: SkillAuthoringCompletionOutcomes.Failed, failureCode: "worker_failed" }, _IDENTITY)).resolves.toBe("conflict");
		expect(transaction.skillWorkload.findFirst).toHaveBeenCalledOnce();
		expect(transaction.skillRevision.updateMany).not.toHaveBeenCalled();
	});

	it("forces rollback when a successful report loses its terminal workload CAS", async function _RollsBackLostCompletionFence()
	{
		const transaction = {
			skillWorkload: { findFirst: vi.fn().mockResolvedValue({ id: "workload-1", kind: "Authoring", state: "Assigned", releasedAt: new Date("2026-07-26T05:00:00.000Z"), workerPodUid: _IDENTITY.podUid, skillRevisionId: "skill-revision-1", skillRevision: { state: "Draft" } }), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
			skillRevision: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		};
		const repository = new PrismaSkillAuthoringCompletionRepository(transaction as never);

		await expect(repository.complete({ workloadId: "workload-1", outcome: SkillAuthoringCompletionOutcomes.Succeeded, testReport: { passed: true, summary: "tests passed", checksRun: 1 }, scanResult: { passed: true, summary: "scan passed", checksRun: 1 } }, _IDENTITY)).rejects.toBeInstanceOf(_SkillWorkloadPersistenceConflictError);
		const mutation = transaction.skillWorkload.updateMany.mock.calls[0]?.[0] as { readonly data?: { readonly completedAt?: Date } } | undefined;
		expect(mutation?.data?.completedAt?.getTime()).toBe(0);
	});
});
