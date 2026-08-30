import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, type ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";

import { PrismaAuditCatalogueUnitOfWork } from "../prisma-audit-catalogue";

/** Builds a central-authority fake that keeps one requested resource. */
function _Authorization(allowedId: string): AuthorizationAuthority
{
	const decision = { outcome: AuthorizationDecisionOutcomes.Deny, reason: "no_matching_grant" as const, grantIds: [], rule: null, evidence: null };
	return {
		decide: vi.fn().mockResolvedValue(decision),
		admit: vi.fn().mockResolvedValue(decision),
		admitPrincipal: vi.fn().mockResolvedValue(decision),
		admitPrincipalBatch: vi.fn(async function _AdmitBatch(commands) { return commands.map(function _Decision() { return decision; }); }),
		listEntitled: vi.fn().mockResolvedValue([]),
		listPrincipalEntitled: vi.fn(async (command: { readonly resources: readonly ProductAuthorizationResourceLocator[] }) => command.resources.filter(resource => resource.id === allowedId)),
		listManagedGrants: vi.fn().mockResolvedValue([]),
		replaceManagedGrants: vi.fn().mockResolvedValue({ ...decision, changedCount: 0 }),
	};
}

describe("PrismaAuditCatalogueUnitOfWork", function _Suite()
{
	it("filters one candidate batch through the transaction-bound central authority", async function _Filters()
	{
		const rows = [
			{ id: 2, timestamp: new Date("2026-08-29T10:00:00.000Z"), action: "Updated", resource: "Group/two", message: "updated" },
			{ id: 1, timestamp: new Date("2026-08-29T09:00:00.000Z"), action: "Created", resource: "Group/one", message: "created" },
		];
		const transaction = { auditEntry: { findMany: vi.fn().mockResolvedValue(rows) } } as unknown as Prisma.TransactionClient;
		const prisma = { $transaction: vi.fn(async function _Transaction(operation: (client: Prisma.TransactionClient) => Promise<unknown>) { return operation(transaction); }) } as unknown as PrismaClient;
		const authorization = _Authorization("1");
		const unitOfWork = new PrismaAuditCatalogueUnitOfWork(prisma, function _CreateAuthorization(client)
		{
			expect(client).toBe(transaction);
			return authorization;
		});

		const result = await unitOfWork.list({ siloId: "silo-1", principalId: "principal-1" }, { limit: 10, before: null });

		expect(result.data).toEqual([{ timestamp: "2026-08-29T09:00:00.000Z", action: "Created", resource: "Group/one", message: "created" }]);
		expect(transaction.auditEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { siloId: "silo-1" } }));
		expect(authorization.listPrincipalEntitled).toHaveBeenCalledWith(expect.objectContaining({ siloId: "silo-1", principalId: "principal-1", action: "read", resources: [{ kind: "audit-log", id: "2" }, { kind: "audit-log", id: "1" }] }));
	});
});
