import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";

import { PrismaAuthenticatedPrincipalAdmissionUnitOfWork } from "../prisma-authenticated-principal-admission-unit-of-work";

/** Build the exact transaction delegates used by authenticated Principal admission. */
function _Prisma(resolvedPrincipal: { id: string; siloId: string } | null = { id: "principal-1", siloId: "silo-a" }): {
	readonly prisma: PrismaClient;
	readonly principalFindUnique: ReturnType<typeof vi.fn>;
}
{
	const principalFindUnique = vi.fn().mockResolvedValue(resolvedPrincipal);
	const transaction = {
		principal: { findUnique: principalFindUnique },
	};
	const prisma = {
		$transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }),
	} as unknown as PrismaClient;
	return { prisma, principalFindUnique };
}

describe("PrismaAuthenticatedPrincipalAdmissionUnitOfWork", function _Suite()
{
	it("resolves the exact issuer-scoped Principal without reprojecting cached claims", async function _Admits()
	{
		const { prisma, principalFindUnique } = _Prisma();
		const admission = new PrismaAuthenticatedPrincipalAdmissionUnitOfWork(prisma, { warn: vi.fn() } as unknown as Logger);

		await expect(admission.admit({ siloId: "silo-a", issuer: "https://issuer.example", subject: "subject-1" }))
			.resolves.toEqual({ principalId: "principal-1", siloId: "silo-a", issuer: "https://issuer.example", subject: "subject-1" });
		expect(principalFindUnique).toHaveBeenCalledWith({ where: { siloId_issuer_subject: { siloId: "silo-a", issuer: "https://issuer.example", subject: "subject-1" } }, select: { id: true, siloId: true } });
	});

	it("returns null when exact local resolution cannot observe the reconciled Principal", async function _RejectsStaleProjection()
	{
		const { prisma } = _Prisma(null);
		const admission = new PrismaAuthenticatedPrincipalAdmissionUnitOfWork(prisma, { warn: vi.fn() } as unknown as Logger);

		await expect(admission.admit({ siloId: "silo-a", issuer: "https://issuer.example", subject: "subject-1" })).resolves.toBeNull();
	});

	it("rejects incomplete identity coordinates before opening a transaction", async function _RejectsIncompleteIdentity()
	{
		const { prisma } = _Prisma();
		const admission = new PrismaAuthenticatedPrincipalAdmissionUnitOfWork(prisma, { warn: vi.fn() } as unknown as Logger);

		await expect(admission.admit({ siloId: "", issuer: "https://issuer.example", subject: "subject-1" })).resolves.toBeNull();
		expect(prisma.$transaction).not.toHaveBeenCalled();
	});
});
