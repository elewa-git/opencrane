import { ArtifactPreprocessJobState, ArtifactRevisionState, ArtifactState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ArtifactPreprocessTaskNames } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import { __CreateArtifactPreprocessBootstrapReference } from "@opencrane/contracts";

import { PrismaArtifactPreprocessControllerRepository } from "../prisma-artifact-preprocess-controller-authority";

/** Fixed database time used by claim and completion tests. */
const _NOW = new Date("2026-08-27T10:00:00.000Z");

/** Returns the receipt saved with the preprocessing job. */
function _Task()
{
	return { taskId: "task-1", taskName: ArtifactPreprocessTaskNames.Convert, idempotencyKey: `workflows:artifact-preprocess:${"a".repeat(64)}` };
}

/** Returns one admitted PDF preprocessing row before its controller claim. */
function _Job(overrides: Record<string, unknown> = {}): Record<string, unknown>
{
	const task = _Task();
	return {
		id: "preprocess-1",
		sourceRevisionId: "revision-1",
		pipelineVersion: "pdf-to-text/v1",
		taskId: task.taskId,
		taskName: task.taskName,
		taskKey: task.idempotencyKey,
		state: ArtifactPreprocessJobState.Pending,
		claimFence: null,
		profileName: null,
		claimedAt: null,
		deliveryCount: 0,
		claimExpiresAt: null,
		workloadUid: null,
		firstPodUid: null,
		bootstrapReferenceHash: null,
		bootstrapNamespace: null,
		nextAttemptAt: null,
		derivedArtifactId: null,
		completionDigest: null,
		completionConsumedAt: null,
		sourceRevision: { state: ArtifactRevisionState.Published, mediaType: "application/pdf", byteLength: 4n, artifact: { siloId: "silo-1", ownerPrincipalId: "owner-1", state: ArtifactState.Active } },
		...overrides,
	};
}

/** Builds a transaction double that applies update data to one in-memory job row. */
function _Harness(initial: Record<string, unknown> = _Job(), updateCount = 1)
{
	let job = initial;
	const updateMany = vi.fn(async function _Update(input: { readonly data: Record<string, unknown> }): Promise<{ readonly count: number }>
	{
		if (updateCount === 1)
		{
			job = { ...job, ...input.data };
		}
		return { count: updateCount };
	});
	const update = vi.fn(async function _Update(input: { readonly data: Record<string, unknown> }): Promise<Record<string, unknown>>
	{
		job = { ...job, ...input.data };
		return job;
	});
	const transaction = {
		artifactAuthorityClock: { findUnique: vi.fn().mockResolvedValue({ now: _NOW }) },
		artifactPreprocessJob: { findUnique: vi.fn(async function _Find(): Promise<Record<string, unknown>> { return job; }), updateMany, update },
		artifact: { create: vi.fn().mockResolvedValue({}) },
	};
	return { authority: new PrismaArtifactPreprocessControllerRepository(transaction as never), transaction, job: function _Current(): Record<string, unknown> { return job; } };
}

/** Builds the binding fields copied from one issued controller record. */
function _Binding(record: Awaited<ReturnType<PrismaArtifactPreprocessControllerRepository["claimForTask"]>>)
{
	if (record === null)
	{
		throw new Error("test claim was not issued");
	}
	return { claimId: record.claim.claimId, claimedAt: record.claim.claimedAt, deliveryCount: record.claim.deliveryCount, profileName: record.claim.profileName, workloadUid: "job-uid-1" };
}

describe("Prisma artifact preprocessing controller authority", function _DescribeControllerAuthority()
{
	it("issues a fixed-profile workload claim only for the saved task receipt", async function _ClaimsExactTask()
	{
		const harness = _Harness();

		const record = await harness.authority.claimForTask("preprocess-1", _Task());

		expect(record).toMatchObject({ preprocessJobId: "preprocess-1", siloId: "silo-1", claim: { workloadClass: "artifact-preprocess", profileName: "pdf-preprocessor", deliveryCount: 1, executionReference: "preprocess-1" } });
		expect(Date.parse(record?.claim.expiresAt ?? "")).toBe(_NOW.getTime() + 5 * 60_000);
		expect(harness.transaction.artifact.create).toHaveBeenCalledWith({ data: expect.objectContaining({ siloId: "silo-1", ownerPrincipalId: "owner-1", kind: "Generated" }) });

		const other = _Harness();
		await expect(other.authority.claimForTask("preprocess-1", { ..._Task(), taskId: "other-task" })).resolves.toBeNull();
		expect(other.transaction.artifact.create).not.toHaveBeenCalled();
	});

	it("does not allocate output identity when another controller wins the claim race", async function _LosesClaimRace()
	{
		const harness = _Harness(_Job(), 0);

		await expect(harness.authority.claimForTask("preprocess-1", _Task())).resolves.toBeNull();
		expect(harness.transaction.artifact.create).not.toHaveBeenCalled();
		expect(harness.transaction.artifactPreprocessJob.update).not.toHaveBeenCalled();
	});

	it("binds one immutable Job and first Pod under the issued delivery fence", async function _BindsWorkload()
	{
		const harness = _Harness();
		const record = await harness.authority.claimForTask("preprocess-1", _Task());
		const binding = _Binding(record);
		const bootstrapReference = await __CreateArtifactPreprocessBootstrapReference("preprocess-1");
		const command = { binding, bootstrapReference, namespace: "opencrane-artifact-preprocessor" };

		await expect(harness.authority.bindWorkload("preprocess-1", _Task(), command)).resolves.toBe("bound");
		await expect(harness.authority.bindWorkload("preprocess-1", _Task(), command)).resolves.toBe("idempotent");
		await expect(harness.authority.bindFirstPod("preprocess-1", _Task(), { binding: { ...binding, firstPodUid: "pod-uid-1" } })).resolves.toBe("bound");
		await expect(harness.authority.bindFirstPod("preprocess-1", _Task(), { binding: { ...binding, firstPodUid: "pod-uid-2" } })).resolves.toBe("conflict");
		expect(harness.job()).toMatchObject({ workloadUid: "job-uid-1", firstPodUid: "pod-uid-1", bootstrapNamespace: "opencrane-artifact-preprocessor", bootstrapReferenceHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u) });
		await expect(harness.authority.loadWorkerBootstrap(bootstrapReference, "opencrane-artifact-preprocessor")).resolves.toEqual({ lease: { jobId: "preprocess-1", attempt: 1, claimFence: expect.any(String), expiresAt: new Date(_NOW.getTime() + 5 * 60_000).toISOString() }, sourceMediaType: "application/pdf", sourceByteLength: 4 });
	});

	it("loads and consumes one server-owned completion idempotently", async function _CompletesFromInbox()
	{
		const digest = `sha256:${"b".repeat(64)}`;
		const harness = _Harness(_Job({ state: ArtifactPreprocessJobState.Claimed, claimFence: "claim-1", profileName: "pdf-preprocessor", claimedAt: _NOW, deliveryCount: 1, claimExpiresAt: new Date(_NOW.getTime() + 60_000), workloadUid: "job-uid-1", firstPodUid: "pod-uid-1", completionDigest: digest }));
		const completion = { preprocessJobId: "preprocess-1", completionDigest: digest };

		await expect(harness.authority.loadCompletion("preprocess-1", digest, _Task())).resolves.toEqual(completion);
		await expect(harness.authority.complete("preprocess-1", completion, _Task())).resolves.toBe("completed");
		await expect(harness.authority.complete("preprocess-1", completion, _Task())).resolves.toBe("idempotent");
		expect(harness.job()).toMatchObject({ state: ArtifactPreprocessJobState.Completed, completionConsumedAt: _NOW, completedAt: _NOW });
	});
});
