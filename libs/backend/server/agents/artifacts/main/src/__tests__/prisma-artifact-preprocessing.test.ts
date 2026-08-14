import { describe, expect, it, vi } from "vitest";

import { PrismaArtifactPreprocessRepository } from "../prisma-artifact-preprocessing";

/** Stable database-owned time used by preprocessing delegate tests. */
const _DATABASE_NOW = new Date("2026-08-05T08:00:00.000Z");

/** Exact row exposed by the database-owned SKIP LOCKED candidate view. */
const _CANDIDATE = {
	jobId: "job-1",
	attempt: 0,
	derivedArtifactId: null,
	sourceRevisionId: "revision-1",
	sourceArtifactId: "artifact-1",
	siloId: "silo-1",
	ownerPrincipalId: "user-1",
	sourceByteLength: 12n,
};

describe("Prisma artifact preprocessing", function _Suite()
{
	it("recovers expired claims and claims the typed SKIP LOCKED candidate projection", async function _ClaimsCandidate()
	{
		const transaction = {
			artifactAuthorityClock: { findUnique: vi.fn().mockResolvedValue({ now: _DATABASE_NOW }) },
			artifactPreprocessClaimCandidate: { findFirst: vi.fn().mockResolvedValue(_CANDIDATE) },
			artifactPreprocessJob: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), update: vi.fn().mockResolvedValue({}) },
			artifact: { create: vi.fn().mockResolvedValue({}) },
		};

		const result = await new PrismaArtifactPreprocessRepository(transaction as never).claimNextAtomically();

		expect(result).toEqual({ status: "claimed", claim: expect.objectContaining({ jobId: "job-1", attempt: 1, sourceRevisionId: "revision-1", sourceArtifactId: "artifact-1", siloId: "silo-1", sourceByteLength: 12, claimExpiresAt: new Date(_DATABASE_NOW.getTime() + 5 * 60_000) }) });
		expect(transaction.artifactPreprocessJob.updateMany).toHaveBeenCalledWith({ where: { state: "Claimed", claimExpiresAt: { lte: _DATABASE_NOW } }, data: { state: "RetryableFailed", outputLeaseId: null, failureCode: "claim_expired", nextAttemptAt: _DATABASE_NOW } });
		expect(transaction.artifactPreprocessClaimCandidate.findFirst).toHaveBeenCalledWith({ select: { jobId: true, attempt: true, derivedArtifactId: true, sourceRevisionId: true, sourceArtifactId: true, siloId: true, ownerPrincipalId: true, sourceByteLength: true } });
		expect(transaction.artifact.create).toHaveBeenCalledWith({ data: expect.objectContaining({ siloId: "silo-1", ownerPrincipalId: "user-1", kind: "Generated" }) });
		expect(transaction.artifactAuthorityClock.findUnique).toHaveBeenCalledTimes(2);
		expect(transaction.artifactAuthorityClock.findUnique).toHaveBeenCalledWith({ where: { singleton: 1 }, select: { now: true } });
	});

	it("returns no work when the typed candidate view has no unlocked eligible row", async function _NoCandidate()
	{
		const transaction = {
			artifactAuthorityClock: { findUnique: vi.fn().mockResolvedValue({ now: _DATABASE_NOW }) },
			artifactPreprocessClaimCandidate: { findFirst: vi.fn().mockResolvedValue(null) },
			artifactPreprocessJob: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
		};

		await expect(new PrismaArtifactPreprocessRepository(transaction as never).claimNextAtomically()).resolves.toEqual({ status: "none" });
		expect(transaction.artifactPreprocessClaimCandidate.findFirst).toHaveBeenCalledOnce();
	});
});
