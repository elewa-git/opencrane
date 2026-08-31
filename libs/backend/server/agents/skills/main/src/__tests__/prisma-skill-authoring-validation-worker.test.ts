import { ArtifactRevisionState, ArtifactState, SkillAuthoringValidationCompletionOutcome, SkillAuthoringValidationState, SkillRevisionState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { SkillAuthoringValidationTaskNames } from "@opencrane/backend/agents/skills/workflows/contract";

import { PrismaSkillAuthoringValidationWorkerUnitOfWork } from "../prisma-skill-authoring-validation-worker";
import { SkillAuthoringValidationWorkerOutcomes } from "../skill-authoring-validation-worker.types";

/** Return the Pod identity allowed to consume this validation's worker protocol. */
function _Identity()
{
	return { subject: "system:serviceaccount:authoring:skill-authoring-default", namespace: "authoring", serviceAccountName: "skill-authoring-default", podUid: "pod-uid-1" };
}

/** Return one running validation with a bound task, Job, Pod, and spent bootstrap. */
function _Validation(overrides: Record<string, unknown> = {})
{
	return {
		id: "validation-1",
		siloId: "silo-a",
		skillRevisionId: "revision-1",
		artifactRevisionId: "artifact-revision-1",
		artifactContentAddress: `sha256:${"a".repeat(64)}`,
		taskId: "task-1",
		taskName: SkillAuthoringValidationTaskNames.Validate,
		taskKey: `workflows:skill-authoring-validation:${"b".repeat(64)}`,
		state: SkillAuthoringValidationState.Running,
		workloadClaim: { workloadUid: "job-uid-1", firstPodUid: "pod-uid-1" },
		bootstrap: { referenceHash: `sha256:${"c".repeat(64)}`, namespace: "authoring", serviceAccount: "skill-authoring-default", expiresAt: new Date("2026-08-30T00:00:00.000Z"), consumedAt: new Date("2026-08-29T00:00:00.000Z"), consumedByPodUid: "pod-uid-1" },
		completionInbox: null,
		...overrides,
	};
}

/** Build one transaction harness for the worker's bootstrap, input, and completion operations. */
function _Harness(validation = _Validation())
{
	const transaction = {
		skillAuthorityClock: { findUnique: vi.fn().mockResolvedValue({ now: new Date("2026-08-29T00:00:00.000Z") }) },
		skillAuthoringValidation: {
			findFirst: vi.fn().mockResolvedValue(validation),
			findUnique: vi.fn().mockResolvedValue(validation),
		},
		skillAuthoringValidationBootstrap: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		skillRevision: { findFirst: vi.fn().mockResolvedValue({ id: "revision-1", state: SkillRevisionState.Draft }) },
		artifactRevision: { findFirst: vi.fn().mockResolvedValue({ artifactId: "artifact-1", id: "artifact-revision-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: BigInt(128), mediaType: "application/zip", state: ArtifactRevisionState.Published, artifact: { state: ArtifactState.Active } }) },
		skillAuthoringValidationCompletionInbox: { create: vi.fn().mockResolvedValue({ validationId: "validation-1" }) },
	};
	const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) };
	return { transaction, prisma };
}

describe("Prisma skill authoring validation worker unit of work", function _DescribeWorkerUnitOfWork()
{
	it("reveals a bootstrap only after both Job and first Pod are bound", async function _LoadsBootstrap()
	{
		const harness = _Harness(_Validation({ bootstrap: { ..._Validation().bootstrap, consumedAt: null, consumedByPodUid: null } }));
		const authority = new PrismaSkillAuthoringValidationWorkerUnitOfWork(harness.prisma as never);

		const record = await authority.loadBootstrap(`sha256:${"c".repeat(64)}`);

		expect(record).toEqual({ validationId: "validation-1", namespace: "authoring", serviceAccountName: "skill-authoring-default", podUid: "pod-uid-1" });
		expect(harness.transaction.skillAuthoringValidation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ state: SkillAuthoringValidationState.Running }) }));
		expect(harness.transaction.skillAuthoringValidation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ bootstrap: { is: expect.objectContaining({ expiresAt: { gt: new Date("2026-08-29T00:00:00.000Z") } }) } }) }));
	});

	it("consumes a bootstrap only for the exact bound Pod identity", async function _ConsumesBootstrap()
	{
		const validation = _Validation({ bootstrap: { ..._Validation().bootstrap, consumedAt: null, consumedByPodUid: null } });
		const harness = _Harness(validation);
		const authority = new PrismaSkillAuthoringValidationWorkerUnitOfWork(harness.prisma as never);

		const outcome = await authority.consumeBootstrap(`sha256:${"c".repeat(64)}`, _Identity());

		expect(outcome).toBe("consumed");
		expect(harness.transaction.skillAuthoringValidationBootstrap.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ validationId: "validation-1", namespace: "authoring", serviceAccount: "skill-authoring-default" }), data: expect.objectContaining({ consumedByPodUid: "pod-uid-1" }) }));
		expect(harness.transaction.skillAuthoringValidationBootstrap.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ expiresAt: { gt: new Date("2026-08-29T00:00:00.000Z") } }) }));
	});

	it("returns conflict when an expired bootstrap no longer matches the database-time update", async function _RejectsExpiredBootstrap()
	{
		const validation = _Validation({ bootstrap: { ..._Validation().bootstrap, consumedAt: null, consumedByPodUid: null } });
		const harness = _Harness(validation);
		harness.transaction.skillAuthoringValidationBootstrap.updateMany.mockResolvedValue({ count: 0 });
		const authority = new PrismaSkillAuthoringValidationWorkerUnitOfWork(harness.prisma as never);

		await expect(authority.consumeBootstrap(`sha256:${"c".repeat(64)}`, _Identity())).resolves.toBe("conflict");
	});

	it("loads only the pinned published artifact for the Pod that spent the bootstrap", async function _LoadsInput()
	{
		const harness = _Harness();
		const authority = new PrismaSkillAuthoringValidationWorkerUnitOfWork(harness.prisma as never);

		const input = await authority.loadInput("validation-1", _Identity());

		expect(input).toEqual({ siloId: "silo-a", artifactId: "artifact-1", artifactRevisionId: "artifact-revision-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 128, mediaType: "application/zip" });
		expect(harness.transaction.skillRevision.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "revision-1", state: SkillRevisionState.Draft }) }));
		expect(harness.transaction.artifactRevision.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ state: ArtifactRevisionState.Published, artifact: { siloId: "silo-a", state: ArtifactState.Active } }) }));
	});

	it("saves successful evidence through the worker transaction", async function _CompletesAtomically()
	{
		const harness = _Harness();
		const authority = new PrismaSkillAuthoringValidationWorkerUnitOfWork(harness.prisma as never);
		const command = { validationId: "validation-1", outcome: SkillAuthoringValidationWorkerOutcomes.Succeeded, testReport: { passed: true, summary: "tests passed", checksRun: 3 }, scanResult: { passed: true, summary: "scan passed", checksRun: 2 } } as const;

		const outcome = await authority.complete(command, _Identity());

		expect(outcome).toBe("completed");
		expect(harness.transaction.skillAuthoringValidationCompletionInbox.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ validationId: "validation-1", outcome: SkillAuthoringValidationCompletionOutcome.Succeeded, testReport: command.testReport, scanResult: command.scanResult, failureCode: null }) }));
	});

	it("accepts an identical completion replay without writing a second inbox", async function _ReplaysIdempotently()
	{
		const firstHarness = _Harness();
		const firstAuthority = new PrismaSkillAuthoringValidationWorkerUnitOfWork(firstHarness.prisma as never);
		const command = { validationId: "validation-1", outcome: SkillAuthoringValidationWorkerOutcomes.Failed, failureCode: "tests_failed" } as const;
		await firstAuthority.complete(command, _Identity());
		const created = firstHarness.transaction.skillAuthoringValidationCompletionInbox.create.mock.calls[0]?.[0] as { readonly data: { readonly completionDigest: string } };
		const replayHarness = _Harness(_Validation({ completionInbox: { completionDigest: created.data.completionDigest } }));
		const replayAuthority = new PrismaSkillAuthoringValidationWorkerUnitOfWork(replayHarness.prisma as never);

		const outcome = await replayAuthority.complete(command, _Identity());

		expect(outcome).toBe("idempotent");
		expect(replayHarness.transaction.skillAuthoringValidationCompletionInbox.create).not.toHaveBeenCalled();
	});

	it("rejects completion from any Pod other than the bound first Pod", async function _RejectsOtherPod()
	{
		const harness = _Harness();
		const authority = new PrismaSkillAuthoringValidationWorkerUnitOfWork(harness.prisma as never);
		const command = { validationId: "validation-1", outcome: SkillAuthoringValidationWorkerOutcomes.Failed, failureCode: "tests_failed" } as const;

		const outcome = await authority.complete(command, { ..._Identity(), podUid: "other-pod" });

		expect(outcome).toBe("conflict");
		expect(harness.transaction.skillAuthoringValidationCompletionInbox.create).not.toHaveBeenCalled();
	});
});
