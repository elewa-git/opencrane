import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, type ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";

import { PrismaAuditCatalogueUnitOfWork } from "../prisma-audit-catalogue";
import type { AuditCatalogueCandidate, AuditPageCursor } from "../routes/audit.types";

/** Test row with the storage silo retained for query filtering. */
type StoredAuditRow = AuditCatalogueCandidate & { readonly siloId: string };

/** Builds a central-authority fake that keeps the requested resource identifiers. */
function _Authorization(allowedIds: ReadonlySet<string>): AuthorizationAuthority
{
	const decision = { outcome: AuthorizationDecisionOutcomes.Deny, reason: "no_matching_grant" as const, grantIds: [], rule: null, evidence: null };
	return {
		decide: vi.fn().mockResolvedValue(decision),
		decidePrincipal: vi.fn().mockResolvedValue(decision),
		admit: vi.fn().mockResolvedValue(decision),
		admitPrincipal: vi.fn().mockResolvedValue(decision),
		admitPrincipalBatch: vi.fn(async function _AdmitBatch(commands) { return commands.map(function _Decision() { return decision; }); }),
		listEntitled: vi.fn().mockResolvedValue([]),
		listPrincipalEntitled: vi.fn(async function _ListPrincipalEntitled(command: { readonly resources: readonly ProductAuthorizationResourceLocator[] }) { return command.resources.filter(resource => allowedIds.has(resource.id)); }),
		replaceManagedGrants: vi.fn().mockResolvedValue({ ...decision, changedCount: 0 }),
		retireResourceGrants: vi.fn().mockResolvedValue({ ...decision, changedCount: 0 }),
	};
}

/** Creates a transaction fake that applies the package's descending compound-key query. */
function _Transaction(rows: readonly StoredAuditRow[]): Prisma.TransactionClient
{
	const findMany = vi.fn(async function _FindMany(options: { readonly where: { readonly siloId: string; readonly OR?: readonly [{ readonly timestamp: { readonly lt: Date } }, { readonly timestamp: Date; readonly id: { readonly lt: number } }] }; readonly take: number })
	{
		const cursor = options.where.OR === undefined ? null : { timestamp: options.where.OR[1].timestamp, id: options.where.OR[1].id.lt };
		return rows
			.filter(row => row.siloId === options.where.siloId)
			.filter(row => cursor === null || row.timestamp < cursor.timestamp || (row.timestamp.getTime() === cursor.timestamp.getTime() && row.id < cursor.id))
			.sort(function _Descending(left, right) { return right.timestamp.getTime() - left.timestamp.getTime() || right.id - left.id; })
			.slice(0, options.take)
			.map(function _Candidate(row): AuditCatalogueCandidate { return { id: row.id, timestamp: row.timestamp, action: row.action, resource: row.resource, message: row.message }; });
	});
	return { auditEntry: { findMany } } as unknown as Prisma.TransactionClient;
}

/** Creates the transaction-owning catalogue under test. */
function _Catalogue(rows: readonly StoredAuditRow[], authorization: AuthorizationAuthority): { readonly catalogue: PrismaAuditCatalogueUnitOfWork; readonly transaction: Prisma.TransactionClient }
{
	const transaction = _Transaction(rows);
	const prisma = { $transaction: vi.fn(async function _RunTransaction(operation: (client: Prisma.TransactionClient) => Promise<unknown>) { return operation(transaction); }) } as unknown as PrismaClient;
	const catalogue = new PrismaAuditCatalogueUnitOfWork(prisma, function _CreateAuthorization(client)
	{
		expect(client).toBe(transaction);
		return authorization;
	});
	return { catalogue, transaction };
}

/** Creates one stored audit row. */
function _Row(id: number, timestamp: string, siloId = "silo-1"): StoredAuditRow
{
	return { id, siloId, timestamp: new Date(timestamp), action: `Action ${id}`, resource: `Group/${id}`, message: `message ${id}` };
}

/** Reads every candidate page until the catalogue reports exhaustion. */
async function _ReadAll(catalogue: PrismaAuditCatalogueUnitOfWork, limit: number): Promise<readonly number[]>
{
	const ids: number[] = [];
	let before: AuditPageCursor | null = null;
	let hasMore = true;
	while (hasMore)
	{
		const page = await catalogue.list({ siloId: "silo-1", principalId: "principal-1" }, { limit, before });
		ids.push(...page.data.map(entry => Number(entry.resource.split("/")[1])));
		before = page.nextCursor;
		hasMore = page.hasMore;
	}
	return ids;
}

describe("PrismaAuditCatalogueUnitOfWork", function _Suite()
{
	it("reads three pages of identical timestamps without skipping an identifier", async function _IdenticalTimestamps()
	{
		const timestamp = "2026-08-29T10:00:00.000Z";
		const rows = [6, 5, 4, 3, 2, 1].map(id => _Row(id, timestamp));
		const authorization = _Authorization(new Set(rows.map(row => String(row.id))));
		const { catalogue } = _Catalogue(rows, authorization);

		await expect(_ReadAll(catalogue, 2)).resolves.toEqual([6, 5, 4, 3, 2, 1]);
	});

	it("uses the identifier only after the timestamp coordinate matches", async function _MixedTimestamps()
	{
		const rows = [_Row(6, "2026-08-29T12:00:00.000Z"), _Row(5, "2026-08-29T11:00:00.000Z"), _Row(4, "2026-08-29T11:00:00.000Z"), _Row(9, "2026-08-29T10:00:00.000Z"), _Row(1, "2026-08-29T09:00:00.000Z")];
		const authorization = _Authorization(new Set(rows.map(row => String(row.id))));
		const { catalogue } = _Catalogue(rows, authorization);

		await expect(_ReadAll(catalogue, 2)).resolves.toEqual([6, 5, 4, 9, 1]);
	});

	it("advances after denied candidates when the visible page is empty", async function _DeniedPage()
	{
		const rows = [5, 4, 3, 2, 1].map(id => _Row(id, "2026-08-29T10:00:00.000Z"));
		const authorization = _Authorization(new Set(["2", "1"]));
		const { catalogue } = _Catalogue(rows, authorization);

		const first = await catalogue.list({ siloId: "silo-1", principalId: "principal-1" }, { limit: 2, before: null });
		expect(first).toEqual({ data: [], hasMore: true, nextCursor: { timestamp: rows[1].timestamp, id: 4 } });
		const second = await catalogue.list({ siloId: "silo-1", principalId: "principal-1" }, { limit: 2, before: first.nextCursor });
		expect(second.data.map(entry => entry.resource)).toEqual(["Group/2"]);
		expect(second.nextCursor).toEqual({ timestamp: rows[3].timestamp, id: 2 });
	});

	it("keeps the silo query and current Principal authorization coordinates unchanged", async function _KeepsAuthorizationBoundary()
	{
		const rows = [_Row(3, "2026-08-29T11:00:00.000Z", "silo-2"), _Row(2, "2026-08-29T10:00:00.000Z"), _Row(1, "2026-08-29T09:00:00.000Z")];
		const authorization = _Authorization(new Set(["1"]));
		const { catalogue, transaction } = _Catalogue(rows, authorization);

		const result = await catalogue.list({ siloId: "silo-1", principalId: "principal-1" }, { limit: 10, before: null });

		expect(result.data.map(entry => entry.resource)).toEqual(["Group/1"]);
		expect(transaction.auditEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { siloId: "silo-1" } }));
		expect(authorization.listPrincipalEntitled).toHaveBeenCalledWith(expect.objectContaining({ siloId: "silo-1", principalId: "principal-1", action: "read", resources: [{ kind: "audit-log", id: "2" }, { kind: "audit-log", id: "1" }] }));
	});
});
