import { ArtifactPreprocessJobState, ArtifactUploadLeaseState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaArtifactPreprocessRepository } from "../prisma-artifact-preprocessing";

/** Stable database time used by preprocessing delegate tests. */
const _DATABASE_NOW = new Date("2026-08-27T10:00:00.000Z");

/** Returns one verified promotion bound to the current output lease. */
function _CompletionRequest()
{
	return {
		jobId: "job-1",
		attempt: 1,
		claimFence: "claim-1",
		derivedRevisionId: "artifact-preprocess:lease-1",
		promotion: { leaseId: "lease-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 12, mediaType: "text/plain", issuedAtEpochSeconds: 1_787_824_000 },
		receiptDigest: `sha256:${"b".repeat(64)}`,
	};
}

describe("Prisma artifact preprocessing", function _Suite()
{
	it("publishes worker output into the controller inbox without writing terminal state", async function _SavesCompletionInbox()
	{
		const request = _CompletionRequest();
		const transaction = {
			artifactAuthorityClock: { findUnique: vi.fn().mockResolvedValue({ now: _DATABASE_NOW }) },
			artifactPreprocessJob: {
				findUnique: vi.fn().mockResolvedValue({
					id: request.jobId,
					sourceRevisionId: "source-revision-1",
					state: ArtifactPreprocessJobState.Claimed,
					deliveryCount: request.attempt,
					claimFence: request.claimFence,
					claimExpiresAt: new Date(_DATABASE_NOW.getTime() + 60_000),
					completionDigest: null,
					outputLease: { id: "lease-1", state: ArtifactUploadLeaseState.Active, siloId: "silo-1", expectedContentAddress: request.promotion.contentAddress, expectedByteLength: 12n, mediaType: "text/plain" },
					derivedArtifact: { id: "derived-artifact-1", siloId: "silo-1" },
				}),
				update: vi.fn().mockResolvedValue({}),
			},
			artifactUploadLease: { update: vi.fn().mockResolvedValue({}) },
			artifactRevision: { create: vi.fn().mockResolvedValue({}) },
			artifact: { update: vi.fn().mockResolvedValue({}) },
			artifactRevisionParent: { create: vi.fn().mockResolvedValue({}) },
			artifactOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
		};

		await expect(new PrismaArtifactPreprocessRepository(transaction as never).completeAtomically(request)).resolves.toEqual({ status: "completed" });
		expect(transaction.artifactPreprocessJob.update).toHaveBeenCalledWith({ where: { id: "job-1" }, data: { derivedRevisionId: "artifact-preprocess:lease-1", completionDigest: request.receiptDigest } });
		expect(transaction.artifactPreprocessJob.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: expect.anything(), completedAt: expect.anything() }) }));
	});
});
