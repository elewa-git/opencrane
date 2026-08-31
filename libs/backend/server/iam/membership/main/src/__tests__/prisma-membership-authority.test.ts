import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaFleetMembershipAuthorityUnitOfWork } from "../prisma-membership-authority";

/** Creates one verified signed membership revision row. */
function _revisionRow()
{
	return {
		id: "membership-7",
		revision: 7,
		issuerId: "fleet-1",
		issuerKeyId: "key-1",
		siloId: "silo-1",
		issuedAt: new Date("2026-07-18T00:00:00.000Z"),
		expiresAt: new Date("2026-07-18T01:00:00.000Z"),
		payloadDigest: `sha256:${"1".repeat(64)}`,
		signature: "signature-7",
		assertions: [{ assertionId: "assertion-1", siloId: "silo-1", subjectId: "user-1" }],
	};
}

describe("Prisma fleet-membership authority adapter", function _suite()
{
	it("maps the latest verified silo-membership assertion without categorical scope fields", async function _latest()
	{
		const transaction = { verifiedFleetMembershipRevision: { findFirst: vi.fn().mockResolvedValue(_revisionRow()) } };
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaFleetMembershipAuthorityUnitOfWork(prisma);

		const revision = await repository.getLatestSignedRevision("fleet-1", "silo-1");

		expect(revision?.assertions[0]).toEqual({ assertionId: "assertion-1", siloId: "silo-1", subjectId: "user-1" });
	});

	it("creates a newer high-watermark and audit through one Serializable transaction", async function _accept()
	{
		const create = vi.fn().mockResolvedValue({ revision: 7 });
		const auditCreate = vi.fn().mockResolvedValue({ id: "audit-1" });
		const transaction = {
			highestAcceptedFleetMembership: { findUnique: vi.fn().mockResolvedValue(null), create },
			verifiedFleetMembershipRevision: { findFirst: vi.fn().mockResolvedValue(_revisionRow()) },
			auditDecision: { create: auditCreate },
		};
		const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaFleetMembershipAuthorityUnitOfWork(prisma);

		await expect(repository.acceptRevisionAtomically({ issuerId: "fleet-1", siloId: "silo-1", revision: 7, payloadDigest: `sha256:${"1".repeat(64)}` })).resolves.toEqual({ status: "accepted", highestAcceptedRevision: 7 });
		expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
		expect(create).toHaveBeenCalledOnce();
		expect(auditCreate).toHaveBeenCalledOnce();
	});
});
