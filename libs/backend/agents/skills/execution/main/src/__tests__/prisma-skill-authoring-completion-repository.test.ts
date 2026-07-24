import { describe, expect, it, vi } from "vitest";

import { PrismaSkillAuthoringCompletionRepository } from "../prisma-skill-authoring-completion-repository.js";

/** Successful bounded evidence used to exercise the authoring-only persistence transition. */
const _SUCCESS = { workloadId: "workload-1", outcome: "succeeded" as const, testReport: { passed: true, summary: "tests passed", checksRun: 2 }, scanResult: { passed: true, summary: "scan passed", checksRun: 3 } };

/** Exact reviewed Pod identity that must match both registration and consumed bootstrap. */
const _IDENTITY = { namespace: "opencrane-skill-authoring", serviceAccountName: "skill-authoring-default", podUid: "pod-uid-1" };

/** Builds a Prisma transaction double with the one fenced authoring workload available. */
function _Prisma(overrides: { readonly locked?: boolean; readonly revisionUpdated?: boolean; readonly workloadUpdated?: boolean } = {})
{
	const transaction = {
		$queryRaw: vi.fn().mockResolvedValue(overrides.locked === false ? [] : [{ id: "workload-1" }]),
		skillWorkload: { findFirst: vi.fn().mockResolvedValue({ id: "workload-1", skillRevisionId: "revision-1", skillRevision: { state: "Draft" } }), updateMany: vi.fn().mockResolvedValue({ count: overrides.workloadUpdated === false ? 0 : 1 }) },
		skillRevision: { updateMany: vi.fn().mockResolvedValue({ count: overrides.revisionUpdated === false ? 0 : 1 }) },
	};
	const prisma = { $transaction: async function _Transaction(callback: (value: typeof transaction) => Promise<unknown>) { return callback(transaction); } } as never;
	return { repository: new PrismaSkillAuthoringCompletionRepository(prisma), transaction };
}

describe("Prisma skill authoring completion authority", function _DescribeCompletion()
{
	it("writes passed reports before one terminal workload compare-and-set", async function _Completes()
	{
		const { repository, transaction } = _Prisma();

		expect(await repository.completeAtomically(_SUCCESS, _IDENTITY)).toBe("completed");
		expect(transaction.skillRevision.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ testReport: _SUCCESS.testReport, scanResult: _SUCCESS.scanResult }) }));
		expect(transaction.skillWorkload.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "workload-1", state: "Assigned" }), data: expect.objectContaining({ state: "Succeeded", failureCode: null }) }));
	});

	it("does not write reports when the workload lock cannot be acquired", async function _RejectsMissingWorkload()
	{
		const { repository, transaction } = _Prisma({ locked: false });

		expect(await repository.completeAtomically(_SUCCESS, _IDENTITY)).toBe("conflict");
		expect(transaction.skillWorkload.findFirst).not.toHaveBeenCalled();
		expect(transaction.skillRevision.updateMany).not.toHaveBeenCalled();
	});

	it("does not terminalise when the draft evidence compare-and-set has already been consumed", async function _RejectsEvidenceReplay()
	{
		const { repository, transaction } = _Prisma({ revisionUpdated: false });

		expect(await repository.completeAtomically(_SUCCESS, _IDENTITY)).toBe("conflict");
		expect(transaction.skillWorkload.updateMany).not.toHaveBeenCalled();
	});
});
