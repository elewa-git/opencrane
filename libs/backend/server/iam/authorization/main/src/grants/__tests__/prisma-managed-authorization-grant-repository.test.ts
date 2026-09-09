import type { AuthorizationGrant, Prisma } from "@prisma/client";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationDecisionOutcomes, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";
import { describe, expect, it, vi } from "vitest";

import type { AdmitPrincipalProductAuthorizationCommand } from "../../authority/authorization-authority.types";
import type { ReconcileManagedAuthorizationGrantsCommand } from "../managed-authorization-grants.types";
import { PrismaAuthorizationAuthority } from "../../authority/persistence/prisma-authorization-authority";
import { PrismaManagedAuthorizationGrantRepository } from "../persistence/prisma-managed-authorization-grant-repository";

/** Represents a server operation begun before PostgreSQL opens its transaction. */
const _OPERATION_TIME = new Date("2026-09-08T00:00:00.000Z");
/** Models the schema's now() default being later than the operation's frozen decision time. */
const _DATABASE_TIME = new Date(_OPERATION_TIME.getTime() + 100);

/** Runs actual grant mapping, policy evaluation and audit recording over in-memory Prisma delegates. */
function _Fixture()
{
	const rows: AuthorizationGrant[] = [];
	const transaction = {
		principal: { findUnique: vi.fn().mockResolvedValue({ id: "principal-1", subject: "subject-1", provenance: "External" }) },
		orgMembership: { findFirst: vi.fn().mockResolvedValue({ id: "membership-1" }) },
		groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
		authorizationGrant: {
			findMany: vi.fn(async function _Find({ where }: { where: { managerId?: string; resourceKind?: string; resourceId?: string } })
			{
				if (where.managerId === undefined)
					return rows;
				return rows.filter(row => row.managerId === where.managerId && row.resourceKind === where.resourceKind && row.resourceId === where.resourceId && row.effect === "Allow" && row.revokedAt === null);
			}),
			create: vi.fn(async function _Create({ data }: { data: Prisma.AuthorizationGrantUncheckedCreateInput })
			{
				const row = { id: `grant-${rows.length + 1}`, ...data, validFrom: data.validFrom ?? _DATABASE_TIME, expiresAt: null, revokedAt: null, createdAt: _DATABASE_TIME } as AuthorizationGrant;
				rows.push(row);
				return row;
			}),
			updateMany: vi.fn(async function _Revoke({ where, data }: { where: { id: { in: string[] } }; data: { revokedAt: Date } })
			{
				for (const row of rows)
					if (where.id.in.includes(row.id))
						row.revokedAt = data.revokedAt;
				return { count: where.id.in.length };
			}),
		},
		auditEntry: { create: vi.fn().mockResolvedValue({}) },
		auditDecision: { create: vi.fn().mockResolvedValue({}) },
	};
	return { rows, transaction, repository: new PrismaManagedAuthorizationGrantRepository(transaction as never), authority: new PrismaAuthorizationAuthority(transaction as never) };
}

/** Builds one exact personal publication grant and the matching recorded admission. */
function _Commands(kind = ProductAuthorizationResourceKinds.Persona, action = ProductAuthorizationActions.Use)
{
	const resource = { kind, id: "resource-1" };
	const capability = __ProductAuthorizationCapability(kind, action)!;
	const reconciliation: ReconcileManagedAuthorizationGrantsCommand = { siloId: "silo-1", managerId: "personal-agent-owner:principal-1", resource, now: _OPERATION_TIME, grants: [{ subject: { kind: AuthorizationSubjectKinds.Principal, principalId: "principal-1" }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId: "principal-1" }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource, priority: 0, createdByPrincipalId: "principal-1" }] };
	const admission: AdmitPrincipalProductAuthorizationCommand = { siloId: "silo-1", principalId: "principal-1", actorKind: "user", actorId: "principal-1", resource, action, nowEpochMs: _OPERATION_TIME.getTime(), argumentsDigest: `sha256:${"a".repeat(64)}` };
	return { reconciliation, admission };
}

describe("managed grant activation and same-transaction admission", function _Suite()
{
	it.each([[ProductAuthorizationResourceKinds.Persona, ProductAuthorizationActions.Use], [ProductAuthorizationResourceKinds.ModelDefinition, ProductAuthorizationActions.Use], [ProductAuthorizationResourceKinds.AgentRevision, ProductAuthorizationActions.Publish]])("admits newly created %s:%s grants at the operation clock before the database default", async function _ImmediateAdmission(kind, action)
	{
		const f = _Fixture();
		const commands = _Commands(kind, action);
		await expect(f.repository.reconcileManagedResourceGrants(commands.reconciliation)).resolves.toBe(1);
		expect(f.rows[0]?.validFrom).toEqual(_OPERATION_TIME);
		await expect(f.authority.admitPrincipal(commands.admission)).resolves.toMatchObject({ outcome: AuthorizationDecisionOutcomes.Allow, evidence: expect.any(Object) });
		expect(f.transaction.auditDecision.create).toHaveBeenCalledOnce();
	});

	it("does not backdate an existing grant when reconciliation retries with an earlier clock", async function _PreservesExistingValidity()
	{
		const f = _Fixture();
		const commands = _Commands();
		await f.repository.reconcileManagedResourceGrants({ ...commands.reconciliation, now: _DATABASE_TIME });
		await expect(f.repository.reconcileManagedResourceGrants(commands.reconciliation)).resolves.toBe(0);
		expect(f.rows[0]?.validFrom).toEqual(_DATABASE_TIME);
		await expect(f.authority.admitPrincipal(commands.admission)).resolves.toMatchObject({ outcome: AuthorizationDecisionOutcomes.Deny, evidence: null });
		expect(f.transaction.auditDecision.create).not.toHaveBeenCalled();
	});

	it("retains revocation and a higher-priority deny despite immediate activation", async function _DenyGuards()
	{
		const f = _Fixture();
		const commands = _Commands();
		await f.repository.reconcileManagedResourceGrants(commands.reconciliation);
		f.rows.push({ ...f.rows[0]!, id: "explicit-deny", managerId: "other-manager", effect: "Deny", priority: 10 });
		await expect(f.authority.admitPrincipal(commands.admission)).resolves.toMatchObject({ outcome: AuthorizationDecisionOutcomes.Deny });
		f.rows.pop();
		await f.repository.reconcileManagedResourceGrants({ ...commands.reconciliation, grants: [], now: _DATABASE_TIME });
		expect(f.rows[0]?.revokedAt).toEqual(_DATABASE_TIME);
		await expect(f.authority.admitPrincipal({ ...commands.admission, nowEpochMs: _DATABASE_TIME.getTime() })).resolves.toMatchObject({ outcome: AuthorizationDecisionOutcomes.Deny });
		expect(f.transaction.auditDecision.create).not.toHaveBeenCalled();
	});

	it("rejects an invalid reconciliation clock before reading or writing grants", async function _InvalidClock()
	{
		const f = _Fixture();
		await expect(f.repository.reconcileManagedResourceGrants({ ..._Commands().reconciliation, now: new Date(Number.NaN) })).rejects.toThrow("coordinates are invalid");
		expect(f.transaction.authorizationGrant.findMany).not.toHaveBeenCalled();
		expect(f.transaction.authorizationGrant.create).not.toHaveBeenCalled();
	});

	it.each(["membership", "expiry"])("retains current %s denial after activating a grant", async function _CurrentAuthority(kind)
	{
		const f = _Fixture();
		const commands = _Commands();
		await f.repository.reconcileManagedResourceGrants(commands.reconciliation);
		if (kind === "membership")
			f.transaction.orgMembership.findFirst.mockResolvedValue(null);
		if (kind === "expiry")
			f.rows[0]!.expiresAt = new Date(_OPERATION_TIME.getTime() + 50);
		await expect(f.authority.admitPrincipal({ ...commands.admission, nowEpochMs: _DATABASE_TIME.getTime() })).resolves.toMatchObject({ outcome: AuthorizationDecisionOutcomes.Deny });
		expect(f.transaction.auditDecision.create).not.toHaveBeenCalled();
	});
});
