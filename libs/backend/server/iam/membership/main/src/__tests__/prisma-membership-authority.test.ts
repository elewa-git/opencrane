import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaFleetMembershipAuthorityRepository } from "../prisma-membership-authority";

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
		const repository = new PrismaFleetMembershipAuthorityRepository(transaction as unknown as Prisma.TransactionClient);

		const revision = await repository.getLatestSignedRevision("fleet-1", "silo-1");

		expect(revision?.assertions[0]).toEqual({ assertionId: "assertion-1", siloId: "silo-1", subjectId: "user-1" });
	});

	it("creates a newer high-watermark and audit inside the caller's transaction", async function _accept()
	{
		const create = vi.fn().mockResolvedValue({ revision: 7 });
		const auditCreate = vi.fn().mockResolvedValue({ id: "audit-1" });
		const transaction = {
			highestAcceptedFleetMembership: { findUnique: vi.fn().mockResolvedValue(null), create },
			verifiedFleetMembershipRevision: { findFirst: vi.fn().mockResolvedValue(_revisionRow()) },
			auditDecision: { create: auditCreate },
		};
		const repository = new PrismaFleetMembershipAuthorityRepository(transaction as unknown as Prisma.TransactionClient);

		await expect(repository.acceptRevisionAtomically({ issuerId: "fleet-1", siloId: "silo-1", revision: 7, payloadDigest: `sha256:${"1".repeat(64)}` })).resolves.toEqual({ status: "accepted", highestAcceptedRevision: 7 });
		expect(create).toHaveBeenCalledOnce();
		expect(auditCreate).toHaveBeenCalledOnce();
	});
});
