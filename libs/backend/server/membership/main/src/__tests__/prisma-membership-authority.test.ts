import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaFleetMembershipAuthorityRepository } from "../prisma-membership-authority.js";

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
		assertions: [{ assertionId: "assertion-1", siloId: "silo-1", subjectId: "user-1", scopeKind: "Project", organizationId: "org-1", scopeResourceId: "project-1" }],
	};
}

describe("Prisma fleet-membership authority adapter", function _suite()
{
	it("maps the latest verified project assertion without inventing department or team parents", async function _latest()
	{
		const prisma = { verifiedFleetMembershipRevision: { findFirst: vi.fn().mockResolvedValue(_revisionRow()) } } as unknown as PrismaClient;
		const repository = new PrismaFleetMembershipAuthorityRepository(prisma);

		const revision = await repository.getLatestSignedRevision("fleet-1", "silo-1");

		expect(revision?.assertions[0]?.scope).toEqual({ kind: "project", organizationId: "org-1", projectId: "project-1" });
	});

	it("commits a newer high-watermark and audit through one serialized transaction", async function _accept()
	{
		const upsert = vi.fn().mockResolvedValue({ revision: 7 });
		const auditCreate = vi.fn().mockResolvedValue({ id: "audit-1" });
		const transaction = {
			$queryRaw: vi.fn().mockResolvedValue([]),
			highestAcceptedFleetMembership: { findUnique: vi.fn().mockResolvedValue(null), upsert },
			verifiedFleetMembershipRevision: { findFirst: vi.fn().mockResolvedValue(_revisionRow()) },
			auditDecision: { create: auditCreate },
		};
		const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaFleetMembershipAuthorityRepository(prisma);

		await expect(repository.acceptRevisionAtomically({ issuerId: "fleet-1", siloId: "silo-1", revision: 7, payloadDigest: `sha256:${"1".repeat(64)}` })).resolves.toEqual({ status: "accepted", highestAcceptedRevision: 7 });
		expect(transaction.$queryRaw).toHaveBeenCalledOnce();
		expect(upsert).toHaveBeenCalledOnce();
		expect(auditCreate).toHaveBeenCalledOnce();
	});
});
