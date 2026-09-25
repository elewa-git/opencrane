import { ArtifactRevisionState, ArtifactUploadLeaseState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ArtifactQuarantineOutcomes, type QuarantineArtifactRevisionCommand } from "../artifact-quarantine.types";
import { PrismaArtifactQuarantineRepository } from "../prisma-artifact-quarantine-repository";

const _NOW = new Date("2026-09-13T10:00:00.000Z");
const _COMMAND: QuarantineArtifactRevisionCommand = {
	siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", createdBy: "requester-subject",
	provenance: { kind: "conversation_generated_file", operationId: "operation-1" },
	promotion: { leaseId: "lease-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 12, mediaType: "text/csv;charset=utf-8", receiptDigest: `sha256:${"b".repeat(64)}` },
};

/** Mutable fixture state represents a committed first finalization across repository instances. */
function _Fixture()
{
	const lease = {
		id: "lease-1", artifactId: "artifact-1", siloId: "silo-1", state: ArtifactUploadLeaseState.Active,
		expectedContentAddress: _COMMAND.promotion.contentAddress, expectedByteLength: 12n, mediaType: _COMMAND.promotion.mediaType,
		expiresAt: new Date(_NOW.getTime() + 60_000), promotionReceiptDigest: null as string | null,
		promotedContentAddress: null as string | null, promotedByteLength: null as bigint | null,
	};
	let revision: Record<string, unknown> | null = null;
	let scanJob: Record<string, unknown> | null = null;
	const transaction = {
		artifact: { findFirst: vi.fn().mockResolvedValue({ id: "artifact-1" }), update: vi.fn() },
		artifactAuthorityClock: { findUnique: vi.fn().mockResolvedValue({ now: _NOW }) },
		artifactUploadLease: {
			findUnique: vi.fn().mockImplementation(async function _ReadLease() { return { ...lease }; }),
			updateMany: vi.fn().mockImplementation(async function _Claim({ data }: { data: Partial<typeof lease> }) { Object.assign(lease, data); return { count: 1 }; }),
			update: vi.fn().mockImplementation(async function _Finalize({ data }: { data: Partial<typeof lease> }) { Object.assign(lease, data); return { ...lease }; }),
		},
		artifactRevision: {
			findUnique: vi.fn().mockImplementation(async function _ReadRevision() { return revision === null ? null : { ...revision, scanJob }; }),
			create: vi.fn().mockImplementation(async function _CreateRevision({ data }: { data: Record<string, unknown> }) { revision = { ...data }; return revision; }),
		},
		artifactScanJob: { create: vi.fn().mockImplementation(async function _CreateScan({ data }: { data: Record<string, unknown> }) { scanJob = { ...data }; return scanJob; }) },
	};
	return { transaction, lease };
}

describe("artifact quarantine receipt admission", function _Suite()
{
	it("saves a quarantined first revision and one scan without publishing a current revision", async function _Quarantine()
	{
		const { transaction } = _Fixture();
		const repository = new PrismaArtifactQuarantineRepository(transaction as never);
		await expect(repository.finalize(_COMMAND)).resolves.toBe(ArtifactQuarantineOutcomes.Accepted);
		expect(transaction.artifactRevision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id: "revision-1", revision: 1, state: ArtifactRevisionState.Quarantined, createdBy: "requester-subject" }) });
		expect(transaction.artifactScanJob.create).toHaveBeenCalledWith({ data: { artifactRevisionId: "revision-1" } });
		expect(transaction.artifactUploadLease.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "lease-1", state: ArtifactUploadLeaseState.Active, expiresAt: { gt: _NOW } } }));
		expect(transaction.artifactUploadLease.update).toHaveBeenCalledWith({ where: { id: "lease-1" }, data: { state: ArtifactUploadLeaseState.Finalized, finalizedAt: _NOW } });
		expect(transaction.artifact.update).not.toHaveBeenCalled();
	});

	it("recovers the same receipt with a new repository without creating a second scan or revision", async function _Replay()
	{
		const { transaction, lease } = _Fixture();
		await new PrismaArtifactQuarantineRepository(transaction as never).finalize(_COMMAND);
		lease.expiresAt = new Date(_NOW.getTime() - 1);
		await expect(new PrismaArtifactQuarantineRepository(transaction as never).finalize(_COMMAND)).resolves.toBe(ArtifactQuarantineOutcomes.Idempotent);
		expect(transaction.artifactRevision.create).toHaveBeenCalledOnce();
		expect(transaction.artifactScanJob.create).toHaveBeenCalledOnce();
		expect(transaction.artifactUploadLease.updateMany).toHaveBeenCalledOnce();
	});

	it.each([
		{ createdBy: "other-subject" },
		{ provenance: { kind: "conversation_generated_file", operationId: "other-operation" } },
		{ promotion: { ..._COMMAND.promotion, receiptDigest: `sha256:${"c".repeat(64)}` } },
	])("refuses a changed receipt replay %j", async function _ChangedReplay(change)
	{
		const { transaction } = _Fixture();
		await new PrismaArtifactQuarantineRepository(transaction as never).finalize(_COMMAND);
		await expect(new PrismaArtifactQuarantineRepository(transaction as never).finalize({ ..._COMMAND, ...change })).resolves.toBe(ArtifactQuarantineOutcomes.Denied);
		expect(transaction.artifactRevision.create).toHaveBeenCalledOnce();
	});

	it.each([
		{ siloId: "other-silo" }, { artifactId: "other-artifact" }, { expectedContentAddress: `sha256:${"c".repeat(64)}` },
		{ expectedByteLength: 13n }, { mediaType: "text/plain" }, { state: ArtifactUploadLeaseState.Cancelled }, { expiresAt: _NOW },
	])("refuses an unavailable or mismatched lease case %#", async function _WrongLease(change)
	{
		const { transaction, lease } = _Fixture();
		Object.assign(lease, change);
		await expect(new PrismaArtifactQuarantineRepository(transaction as never).finalize(_COMMAND)).resolves.toBe(ArtifactQuarantineOutcomes.Denied);
		expect(transaction.artifactRevision.create).not.toHaveBeenCalled();
		expect(transaction.artifactUploadLease.updateMany).not.toHaveBeenCalled();
	});

	it("rejects an inactive artifact before spending the receipt", async function _MissingArtifact()
	{
		const { transaction } = _Fixture();
		transaction.artifact.findFirst.mockResolvedValue(null as never);
		await expect(new PrismaArtifactQuarantineRepository(transaction as never).finalize(_COMMAND)).resolves.toBe(ArtifactQuarantineOutcomes.Denied);
		expect(transaction.artifactUploadLease.updateMany).not.toHaveBeenCalled();
	});

	it("throws on a lost claim so its enclosing transaction cannot commit a partial asset transition", async function _ClaimRace()
	{
		const { transaction } = _Fixture();
		transaction.artifactUploadLease.updateMany.mockResolvedValue({ count: 0 });
		await expect(new PrismaArtifactQuarantineRepository(transaction as never).finalize(_COMMAND)).rejects.toThrow("lost its upload lease");
		expect(transaction.artifactRevision.create).not.toHaveBeenCalled();
	});

	it("propagates scan admission failure to roll back the caller's transaction", async function _ScanFailure()
	{
		const { transaction } = _Fixture();
		transaction.artifactScanJob.create.mockRejectedValue(new Error("scan admission failed"));
		await expect(new PrismaArtifactQuarantineRepository(transaction as never).finalize(_COMMAND)).rejects.toThrow("scan admission failed");
		expect(transaction.artifactUploadLease.update).not.toHaveBeenCalled();
	});

	it("fails closed if the database clock is unavailable", async function _MissingClock()
	{
		const { transaction } = _Fixture();
		transaction.artifactAuthorityClock.findUnique.mockResolvedValue(null as never);
		await expect(new PrismaArtifactQuarantineRepository(transaction as never).finalize(_COMMAND)).rejects.toThrow("database clock unavailable");
		expect(transaction.artifactUploadLease.updateMany).not.toHaveBeenCalled();
	});
});
