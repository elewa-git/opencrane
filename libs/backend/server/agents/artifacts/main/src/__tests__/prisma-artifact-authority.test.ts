import { describe, expect, it, vi } from "vitest";

import { PrismaArtifactAuthorityRepository } from "../prisma-artifact-authority.js";
import { PrismaArtifactCatalogueRepository } from "../prisma-artifact-catalogue-repository.js";

/** Stable database-owned time used by transaction-delegate tests. */
const _DATABASE_NOW = new Date("2026-08-05T08:00:00.000Z");

/** Build one exact finalization command, optionally selecting a PDF source. */
function _command(mediaType = "text/plain")
{
	return { artifactId: "artifact-1", revision: 1, artifactRevisionId: "revision-1", createdBy: "user-1", provenance: { source: "upload" }, idempotencyKey: "finalize-1", promotion: { leaseId: "lease-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 12, mediaType, receiptDigest: `sha256:${"b".repeat(64)}` } };
}

describe("Prisma artifact authority", function _suite()
{
	it("loads only an exact published revision owned by an active artifact in the requested silo", async function _LoadsReadTarget()
	{
		const artifactRevision = { findFirst: vi.fn().mockResolvedValue({ id: "revision-1", artifactId: "artifact-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 12n, mediaType: "text/plain", artifact: { siloId: "silo-1" } }) };
		const repository = new PrismaArtifactCatalogueRepository({ artifactRevision } as never);

		await expect(repository.loadPublishedReadTarget({ siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1" })).resolves.toEqual({ siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 12, mediaType: "text/plain" });
		expect(artifactRevision.findFirst).toHaveBeenCalledWith(expect.objectContaining({
			where: { id: "revision-1", artifactId: "artifact-1", state: "Published", artifact: { siloId: "silo-1", state: "Active" } },
			select: expect.objectContaining({ contentAddress: true, byteLength: true, mediaType: true }),
		}));
	});

	it.each([null, { id: "revision-1", artifactId: "artifact-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: -1n, mediaType: "text/plain", artifact: { siloId: "silo-1" } }, { id: "revision-1", artifactId: "artifact-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: BigInt(Number.MAX_SAFE_INTEGER) + 1n, mediaType: "text/plain", artifact: { siloId: "silo-1" } }])("fails closed for an absent or unsafe published revision projection", async function _RejectsUnsafeReadTarget(row)
	{
		const repository = new PrismaArtifactCatalogueRepository({ artifactRevision: { findFirst: vi.fn().mockResolvedValue(row) } } as never);

		await expect(repository.loadPublishedReadTarget({ siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1" })).resolves.toBeNull();
	});

	it("commits promotion receipt, immutable revision, current pointer, outbox, and final lease state together", async function _finalize()
	{
		const transaction = {
			artifactAuthorityClock: { findUnique: vi.fn().mockResolvedValue({ now: _DATABASE_NOW }) },
			artifactOutboxEvent: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
			artifact: { findFirst: vi.fn().mockResolvedValue({ id: "artifact-1", state: "Active" }), update: vi.fn().mockResolvedValue({}) },
			artifactUploadLease: { findUnique: vi.fn().mockResolvedValue({ id: "lease-1", artifactId: "artifact-1", state: "Active", expiresAt: new Date(_DATABASE_NOW.getTime() + 60_000), expectedContentAddress: `sha256:${"a".repeat(64)}`, expectedByteLength: 12n, mediaType: "text/plain" }), update: vi.fn().mockResolvedValue({}) },
			artifactRevision: { create: vi.fn().mockResolvedValue({}) },
		};
		const result = await new PrismaArtifactAuthorityRepository(transaction as never).finalizeRevisionAtomically(_command());
		expect(result).toEqual({ status: "finalized" });
		expect(transaction.artifactUploadLease.update).toHaveBeenCalledTimes(2);
		expect(transaction.artifactUploadLease.update).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: expect.objectContaining({ promotedAt: _DATABASE_NOW }) }));
		expect(transaction.artifactUploadLease.update).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: expect.objectContaining({ finalizedAt: _DATABASE_NOW }) }));
		expect(transaction.artifactRevision.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ contentAddress: _command().promotion.contentAddress }) }));
		expect(transaction.artifactOutboxEvent.create).toHaveBeenCalledOnce();
	});

	it("creates one durable PDF preprocessing job beside source publication", async function _schedulesPdfPreprocessing()
	{
		const transaction = {
			artifactAuthorityClock: { findUnique: vi.fn().mockResolvedValue({ now: _DATABASE_NOW }) },
			artifactOutboxEvent: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
			artifact: { findFirst: vi.fn().mockResolvedValue({ id: "artifact-1", state: "Active" }), update: vi.fn().mockResolvedValue({}) },
			artifactUploadLease: { findUnique: vi.fn().mockResolvedValue({ id: "lease-1", artifactId: "artifact-1", state: "Active", expiresAt: new Date(_DATABASE_NOW.getTime() + 60_000), expectedContentAddress: `sha256:${"a".repeat(64)}`, expectedByteLength: 12n, mediaType: "application/pdf" }), update: vi.fn().mockResolvedValue({}) },
			artifactRevision: { create: vi.fn().mockResolvedValue({}) },
			artifactPreprocessJob: { create: vi.fn().mockResolvedValue({}) },
		};

		await expect(new PrismaArtifactAuthorityRepository(transaction as never).finalizeRevisionAtomically(_command("application/pdf"))).resolves.toEqual({ status: "finalized" });
		expect(transaction.artifactPreprocessJob.create).toHaveBeenCalledWith({ data: { sourceRevisionId: "revision-1", pipelineVersion: "pdf-to-text/v1" } });
		expect(transaction.artifactOutboxEvent.create).toHaveBeenCalledOnce();
		expect(transaction.artifactOutboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: "RevisionPublished", idempotencyKey: "finalize-1" }) }));
	});

	it("does not publish a revision when the durable lease has already been consumed", async function _consumed()
	{
		const transaction = {
			artifactAuthorityClock: { findUnique: vi.fn().mockResolvedValue({ now: _DATABASE_NOW }) },
			artifactOutboxEvent: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
			artifact: { findFirst: vi.fn().mockResolvedValue({ id: "artifact-1", state: "Active" }), update: vi.fn() },
			artifactUploadLease: { findUnique: vi.fn().mockResolvedValue({ id: "lease-1", artifactId: "artifact-1", state: "Finalized", expiresAt: new Date(_DATABASE_NOW.getTime() + 60_000), expectedContentAddress: `sha256:${"a".repeat(64)}`, expectedByteLength: 12n, mediaType: "text/plain" }), update: vi.fn() },
			artifactRevision: { create: vi.fn() },
		};
		const result = await new PrismaArtifactAuthorityRepository(transaction as never).finalizeRevisionAtomically(_command());
		expect(result).toEqual({ status: "receipt_consumed" });
		expect(transaction.artifactRevision.create).not.toHaveBeenCalled();
	});

	it("never reissues a terminal or expired durable lease for the same capability JTI", async function _terminalLease()
	{
		const transaction = {
			artifactAuthorityClock: { findUnique: vi.fn().mockResolvedValue({ now: _DATABASE_NOW }) },
			artifact: { findFirst: vi.fn().mockResolvedValue({ id: "artifact-1", state: "Active", siloId: "silo-1" }) },
			artifactUploadLease: { findUnique: vi.fn().mockResolvedValue({ id: "lease-1", artifactId: "artifact-1", siloId: "silo-1", state: "Finalized", expiresAt: new Date(_DATABASE_NOW.getTime() + 60_000), expectedContentAddress: `sha256:${"a".repeat(64)}`, expectedByteLength: 12n, mediaType: "text/plain" }), create: vi.fn() },
		};
		const result = await new PrismaArtifactAuthorityRepository(transaction as never).issueLeaseAtomically({ artifactId: "artifact-1", siloId: "silo-1", capabilityJti: "capability-1", expectedContentAddress: `sha256:${"a".repeat(64)}`, expectedByteLength: 12, mediaType: "text/plain", expiresAtEpochSeconds: Math.floor(_DATABASE_NOW.getTime() / 1_000) + 60 });
		expect(result).toEqual({ status: "conflict" });
		expect(transaction.artifactUploadLease.create).not.toHaveBeenCalled();
	});
});
