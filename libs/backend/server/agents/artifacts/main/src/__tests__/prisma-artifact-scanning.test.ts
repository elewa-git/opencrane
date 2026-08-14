import { ArtifactRevisionState, ArtifactScanJobState, ArtifactState } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ArtifactScannerVerdict } from "@opencrane/contracts";

import { PrismaArtifactScanRepository } from "../prisma-artifact-scan-repository";

/** Database-owned time used by every scanner lifecycle test. */
const _NOW = new Date("2026-08-11T21:00:00.000Z");

/** Build one transaction-client-shaped mock with all scanner delegates. */
function _Transaction()
{
	return {
		artifactAuthorityClock: { findUnique: vi.fn().mockResolvedValue({ now: _NOW }) },
		artifactScanJob: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
		artifactRevision: { update: vi.fn() },
		artifact: { update: vi.fn() },
		conversationAsset: { updateMany: vi.fn() },
		artifactOutboxEvent: { create: vi.fn() },
		artifactPreprocessJob: { create: vi.fn() },
	};
}

/** Build one claimed job and its quarantined immutable revision. */
function _ClaimedJob(overrides: Record<string, unknown> = {})
{
	return {
		id: "job-1",
		artifactRevisionId: "revision-1",
		state: ArtifactScanJobState.Claimed,
		attempt: 2,
		claimFence: "fence-2",
		claimExpiresAt: new Date(_NOW.getTime() + 60_000),
		artifactRevision: { id: "revision-1", artifactId: "artifact-1", state: ArtifactRevisionState.Quarantined, contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 3n, mediaType: "image/png", artifact: { siloId: "silo-1", state: ArtifactState.Active } },
		...overrides,
	};
}

describe("PrismaArtifactScanRepository", function _Suite()
{
	const lifecycle = { report: vi.fn() };
	beforeEach(function _Reset() { lifecycle.report.mockReset(); });
	it("uses the configured complete-operation lease when claiming work", async function _ClaimsWithConfiguredLease()
	{
		const transaction = _Transaction();
		transaction.artifactScanJob.findFirst.mockResolvedValue({ ..._ClaimedJob({ state: ArtifactScanJobState.Pending, attempt: 0 }), artifactRevision: _ClaimedJob().artifactRevision });
		transaction.artifactScanJob.updateMany.mockResolvedValue({ count: 1 });
		const repository = new PrismaArtifactScanRepository(transaction as never, 240_000, lifecycle);

		const result = await repository.claim();

		expect(result?.lease.expiresAt).toBe(new Date(_NOW.getTime() + 240_000).toISOString());
		expect(transaction.artifactScanJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ artifactRevision: { state: ArtifactRevisionState.Quarantined } }) }));
		expect(transaction.artifactScanJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ claimExpiresAt: new Date(_NOW.getTime() + 240_000) }) }));
	});

	it("refuses a failure submitted after the database-owned claim deadline", async function _RejectsExpiredFailure()
	{
		const transaction = _Transaction();
		transaction.artifactScanJob.findUnique.mockResolvedValue(_ClaimedJob({ claimExpiresAt: _NOW }));
		const repository = new PrismaArtifactScanRepository(transaction as never, 300_000, lifecycle);

		await expect(repository.fail({ jobId: "job-1", attempt: 2, claimFence: "fence-2", failureCode: "scanner_failed" })).resolves.toBe("stale");
		expect(transaction.artifactScanJob.update).not.toHaveBeenCalled();
	});

	it.each([
		[2, ArtifactScanJobState.RetryableFailed, false],
		[3, ArtifactScanJobState.TerminalFailed, true],
	])("applies bounded failure state for attempt %s", async function _AppliesBoundedFailure(attempt, expectedState, terminal)
	{
		const transaction = _Transaction();
		transaction.artifactScanJob.findUnique.mockResolvedValue(_ClaimedJob({ attempt, claimFence: `fence-${attempt}` }));
		const repository = new PrismaArtifactScanRepository(transaction as never, 300_000, lifecycle);

		await expect(repository.fail({ jobId: "job-1", attempt, claimFence: `fence-${attempt}`, failureCode: "scanner_failed" })).resolves.toBe("failed");
		expect(transaction.artifactScanJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: expectedState }) }));
		expect(lifecycle.report).toHaveBeenCalledTimes(terminal ? 1 : 0);
	});

	it("publishes a clean revision and its ready conversation asset atomically", async function _PublishesClean()
	{
		const transaction = _Transaction();
		transaction.artifactScanJob.findUnique.mockResolvedValue(_ClaimedJob());
		const repository = new PrismaArtifactScanRepository(transaction as never, 300_000, lifecycle);

		await expect(repository.complete({ jobId: "job-1", attempt: 2, claimFence: "fence-2", verdict: ArtifactScannerVerdict.Clean, scannerVersion: "clamav-pinned" })).resolves.toBe("completed");
		expect(transaction.artifactRevision.update).toHaveBeenCalledWith({ where: { id: "revision-1" }, data: { state: ArtifactRevisionState.Published } });
		expect(transaction.artifact.update).toHaveBeenCalledWith({ where: { id: "artifact-1" }, data: { currentRevisionId: "revision-1" } });
		expect(lifecycle.report).toHaveBeenCalledWith({ revisionId: "revision-1", state: "ready", failureCode: null });
	});

	it("rejects unsafe bytes without publishing an artifact pointer", async function _RejectsUnsafe()
	{
		const transaction = _Transaction();
		transaction.artifactScanJob.findUnique.mockResolvedValue(_ClaimedJob());
		const repository = new PrismaArtifactScanRepository(transaction as never, 300_000, lifecycle);

		await expect(repository.complete({ jobId: "job-1", attempt: 2, claimFence: "fence-2", verdict: ArtifactScannerVerdict.Rejected, scannerVersion: "clamav-pinned" })).resolves.toBe("completed");
		expect(transaction.artifactRevision.update).toHaveBeenCalledWith({ where: { id: "revision-1" }, data: { state: ArtifactRevisionState.Rejected } });
		expect(transaction.artifact.update).not.toHaveBeenCalled();
		expect(lifecycle.report).toHaveBeenCalledWith({ revisionId: "revision-1", state: "failed", failureCode: "unsafe_file" });
	});
});
