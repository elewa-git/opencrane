import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes } from "@opencrane/models/authorization";

import { PrismaThirdPartySourceUnitOfWork, ThirdPartySourceAuthorizationError } from "../prisma-third-party-source-authority";

/** Builds a central-authority fake with independently controlled read and admission results. */
function _Authorization(allow: boolean): AuthorizationAuthority
{
	const decision = allow
		? { outcome: AuthorizationDecisionOutcomes.Allow, reason: "winning_allow" as const, grantIds: ["grant-1"], rule: null, evidence: null }
		: { outcome: AuthorizationDecisionOutcomes.Deny, reason: "no_matching_grant" as const, grantIds: [], rule: null, evidence: null };
	return {
		decide: vi.fn().mockResolvedValue(decision),
		admit: vi.fn().mockResolvedValue(decision),
		admitPrincipal: vi.fn().mockResolvedValue(decision),
		listEntitled: vi.fn(async command => allow ? command.resources : []),
		listPrincipalEntitled: vi.fn(async command => allow ? command.resources : []),
		listManagedGrants: vi.fn().mockResolvedValue([]),
		replaceManagedGrants: vi.fn().mockResolvedValue({ ...decision, changedCount: 0 }),
	};
}

/** Builds a root client whose transaction exposes recording source delegates. */
function _Prisma()
{
	const transaction = {
		thirdPartySource: {
			create: vi.fn().mockResolvedValue({ id: "source-1", name: "Registry" }),
			findMany: vi.fn().mockResolvedValue([]),
			updateMany: vi.fn().mockResolvedValue({ count: 1 }),
			deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
		},
		thirdPartySourceItem: { createMany: vi.fn().mockResolvedValue({ count: 0 }), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
		auditEntry: { create: vi.fn().mockResolvedValue({}) },
	} as unknown as Prisma.TransactionClient;
	const prisma = { $transaction: vi.fn(async function _Transaction(operation: (client: Prisma.TransactionClient) => Promise<unknown>) { return operation(transaction); }) } as unknown as PrismaClient;
	return { prisma, transaction };
}

describe("PrismaThirdPartySourceUnitOfWork", function _Suite()
{
	it("denies source creation before persistence without organisation administration", async function _Denied()
	{
		const { prisma, transaction } = _Prisma();
		const unitOfWork = new PrismaThirdPartySourceUnitOfWork(prisma, function _AuthorizationFactory() { return _Authorization(false); });
		const body = { name: "Registry", kind: "mcp-registry" as const, originUrl: "https://registry.example", syncMode: "manual" as const };

		await expect(unitOfWork.create({ siloId: "silo-1", principalId: "principal-1" }, body)).rejects.toBeInstanceOf(ThirdPartySourceAuthorizationError);
		expect(transaction.thirdPartySource.create).not.toHaveBeenCalled();
	});

	it("admits source creation and domain audit in the same transaction", async function _Allowed()
	{
		const { prisma, transaction } = _Prisma();
		const authorization = _Authorization(true);
		const unitOfWork = new PrismaThirdPartySourceUnitOfWork(prisma, function _AuthorizationFactory() { return authorization; });
		const body = { name: "Registry", kind: "mcp-registry" as const, originUrl: "https://registry.example", syncMode: "manual" as const };

		await unitOfWork.create({ siloId: "silo-1", principalId: "principal-1" }, body);

		expect(authorization.admitPrincipal).toHaveBeenCalledWith(expect.objectContaining({ resource: { kind: "organization", id: "silo-1" }, action: "administer" }));
		expect(transaction.thirdPartySource.create).toHaveBeenCalledWith({ data: expect.objectContaining({ siloId: "silo-1" }) });
		expect(transaction.auditEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ siloId: "silo-1" }) });
	});

	it("keeps source catalogue reads and mutations inside the caller silo", async function _SiloBoundary()
	{
		const { prisma, transaction } = _Prisma();
		const unitOfWork = new PrismaThirdPartySourceUnitOfWork(prisma, function _AuthorizationFactory() { return _Authorization(true); });
		const caller = { siloId: "silo-1", principalId: "principal-1" };

		await unitOfWork.list(caller);
		await unitOfWork.update(caller, "source-1", { notes: "reviewed" });
		await unitOfWork.delete(caller, "source-1");

		expect(transaction.thirdPartySource.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { siloId: "silo-1" } }));
		expect(transaction.thirdPartySource.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "source-1", siloId: "silo-1" } }));
		expect(transaction.thirdPartySource.deleteMany).toHaveBeenCalledWith({ where: { id: "source-1", siloId: "silo-1" } });
	});
});
