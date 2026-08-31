import type { Prisma } from "@prisma/client";

import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationSubjectKinds } from "@opencrane/models/authorization";
import type { AuthorizationBoundary, AuthorizationResourceLocator, AuthorizationSubject } from "@opencrane/models/authorization";
import { __ManagedAuthorizationGrantKey, __PlanManagedAuthorizationGrantReconciliation } from "./managed-authorization-grant-policy";
import type { ManagedAuthorizationGrantRepository, ManagedAuthorizationGrantSpec, ReconcileManagedAuthorizationGrantsCommand } from "./managed-authorization-grants.types";

/** Reconciles managed grants through the repository bound to the caller's exact transaction. */
export function __ReconcileManagedAuthorizationGrantsInTransaction(transaction: Prisma.TransactionClient, command: ReconcileManagedAuthorizationGrantsCommand): Promise<number>
{
	return PrismaManagedAuthorizationGrantRepository.reconcileInTransaction(transaction, command);
}

const _SELECT = { id: true, subjectKind: true, subjectGroupId: true, subjectPrincipalId: true, boundaryKind: true, boundaryGroupId: true, boundaryPrincipalId: true, boundaryCoverage: true, catalogId: true, catalogRevision: true, catalogDigest: true, capabilityId: true, resourceKind: true, resourceId: true, priority: true, createdBy: true } as const satisfies Prisma.AuthorizationGrantSelect;
type _Row = Prisma.AuthorizationGrantGetPayload<{ select: typeof _SELECT }>;

function _SubjectData(subject: AuthorizationSubject)
{
	return subject.kind === AuthorizationSubjectKinds.Group
		? { subjectKind: "Group" as const, subjectGroupId: subject.groupId, subjectPrincipalId: null }
		: { subjectKind: "Principal" as const, subjectGroupId: null, subjectPrincipalId: subject.principalId };
}

function _BoundaryData(boundary: AuthorizationBoundary)
{
	return boundary.kind === AuthorizationBoundaryKinds.Group
		? { boundaryKind: "Group" as const, boundaryGroupId: boundary.groupId, boundaryPrincipalId: null }
		: { boundaryKind: "Personal" as const, boundaryGroupId: null, boundaryPrincipalId: boundary.principalId };
}

function _Subject(row: _Row): AuthorizationSubject
{
	if (row.subjectKind === "Group" && row.subjectGroupId && row.subjectPrincipalId === null)
		return { kind: AuthorizationSubjectKinds.Group, groupId: row.subjectGroupId };
	if (row.subjectKind === "Principal" && row.subjectPrincipalId && row.subjectGroupId === null)
		return { kind: AuthorizationSubjectKinds.Principal, principalId: row.subjectPrincipalId };
	throw new Error(`managed authorization grant ${row.id} has inconsistent subject fields`);
}

function _Boundary(row: _Row): AuthorizationBoundary
{
	if (row.boundaryKind === "Group" && row.boundaryGroupId && row.boundaryPrincipalId === null)
		return { kind: AuthorizationBoundaryKinds.Group, groupId: row.boundaryGroupId };
	if (row.boundaryKind === "Personal" && row.boundaryPrincipalId && row.boundaryGroupId === null)
		return { kind: AuthorizationBoundaryKinds.Personal, principalId: row.boundaryPrincipalId };
	throw new Error(`managed authorization grant ${row.id} has inconsistent boundary fields`);
}

function _Spec(row: _Row): ManagedAuthorizationGrantSpec
{
	return { subject: _Subject(row), boundary: _Boundary(row), boundaryCoverage: row.boundaryCoverage === "Exact" ? AuthorizationBoundaryCoverages.Exact : AuthorizationBoundaryCoverages.Descendants, capability: { catalog: { catalogId: row.catalogId, revision: row.catalogRevision, digest: row.catalogDigest as `sha256:${string}` }, capabilityId: row.capabilityId }, resource: { kind: row.resourceKind, id: row.resourceId }, priority: row.priority, createdByPrincipalId: row.createdBy };
}

/** Transaction-scoped adapter for one product editor's isolated grants. */
export class PrismaManagedAuthorizationGrantRepository implements ManagedAuthorizationGrantRepository
{
	private readonly _transaction: Prisma.TransactionClient;

	constructor(transaction: Prisma.TransactionClient) { this._transaction = transaction; }

	/** Applies one validated managed-grant plan through an already-open transaction. */
	static async reconcileInTransaction(transaction: Prisma.TransactionClient, command: ReconcileManagedAuthorizationGrantsCommand): Promise<number>
	{
		const plan = __PlanManagedAuthorizationGrantReconciliation(command);
		const rows = await transaction.authorizationGrant.findMany({ where: { siloId: command.siloId, managerId: command.managerId, resourceKind: command.resource.kind, resourceId: command.resource.id, effect: "Allow", revokedAt: null }, select: _SELECT });
		const currentByKey = new Map(rows.map(row => [__ManagedAuthorizationGrantKey(_Spec(row)), row]));
		const revokedIds = rows.filter(row => !plan.desiredByKey.has(__ManagedAuthorizationGrantKey(_Spec(row)))).map(row => row.id);
		if (revokedIds.length > 0)
			await transaction.authorizationGrant.updateMany({ where: { id: { in: revokedIds }, siloId: command.siloId, managerId: command.managerId, revokedAt: null }, data: { revokedAt: command.now } });
		let createdCount = 0;
		for (const [key, grant] of plan.desiredByKey)
		{
			if (currentByKey.has(key))
				continue;
			await transaction.authorizationGrant.create({ data: { siloId: command.siloId, managerId: command.managerId, ..._SubjectData(grant.subject), ..._BoundaryData(grant.boundary), boundaryCoverage: grant.boundaryCoverage === AuthorizationBoundaryCoverages.Exact ? "Exact" : "Descendants", catalogId: grant.capability.catalog.catalogId, catalogRevision: grant.capability.catalog.revision, catalogDigest: grant.capability.catalog.digest, capabilityId: grant.capability.capabilityId, resourceKind: command.resource.kind, resourceId: command.resource.id, effect: "Allow", priority: grant.priority, createdBy: grant.createdByPrincipalId } });
			createdCount += 1;
		}
		const changedCount = revokedIds.length + createdCount;
		if (changedCount > 0)
			await transaction.auditEntry.create({ data: { siloId: command.siloId, action: "Updated", resource: `AuthorizationGrantManager/${command.managerId}/${command.resource.kind}/${command.resource.id}`, message: `Managed authorization grants reconciled: ${createdCount} created, ${revokedIds.length} revoked` } });
		return changedCount;
	}

	async reconcileManagedResourceGrants(command: ReconcileManagedAuthorizationGrantsCommand): Promise<number>
	{
		return PrismaManagedAuthorizationGrantRepository.reconcileInTransaction(this._transaction, command);
	}
}
