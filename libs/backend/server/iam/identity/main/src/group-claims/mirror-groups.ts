import { Prisma, type PrismaClient } from "@prisma/client";

import type { GroupClaimProjectionRepository, GroupClaimProjectionUnitOfWork, MirrorGroupsOnLoginOptions } from "./identity-workflows.types";

/** Stable prefix used by Zitadel roles that refer to an existing OpenCrane Group ID. */
const _GROUP_CLAIM_PREFIX = "group:";

/** Parse claims that contain one opaque stable Group ID segment. */
export function _ParseGroupClaims(groups: readonly string[] | undefined): string[]
{
	const ids = new Set<string>();
	for (const raw of groups ?? [])
	{
		if (typeof raw !== "string") continue;
		const claim = raw.trim();
		if (!claim.startsWith(_GROUP_CLAIM_PREFIX)) continue;
		const id = claim.slice(_GROUP_CLAIM_PREFIX.length);
		if (id.length === 0 || id.includes(":")) continue;
		ids.add(id);
	}
	return Array.from(ids).sort();
}

/** Delegate verified login projection through its transaction boundary. */
export function _MirrorGroupsOnLogin(options: MirrorGroupsOnLoginOptions, projection: GroupClaimProjectionUnitOfWork): Promise<void>
{
	return projection.reconcile(options);
}

/** Owns Principal and GroupMembership delegates inside a caller-owned transaction. */
class PrismaGroupClaimProjectionRepository implements GroupClaimProjectionRepository
{
	/** Transaction-scoped Prisma surface. */
	private readonly prisma: Prisma.TransactionClient;

	/** Store the transaction supplied by the unit of work. */
	constructor(prisma: Prisma.TransactionClient) { this.prisma = prisma; }

	/** Project the Principal and replace only direct external memberships. */
	async reconcile(options: MirrorGroupsOnLoginOptions, claimedGroupIds: readonly string[]): Promise<void>
	{
		const siloId = options.siloId?.trim() ?? "";
		const issuer = options.issuer?.trim() ?? "";
		const subject = options.subject?.trim() ?? "";
		const create: { siloId: string; issuer: string; subject: string; email?: string; displayName?: string } = { siloId, issuer, subject };
		if (options.email) create.email = options.email;
		if (options.displayName) create.displayName = options.displayName;
		const principal = await this.prisma.principal.upsert({ where: { siloId_issuer_subject: { siloId, issuer, subject } }, create, update: { email: options.email ?? null, displayName: options.displayName ?? null }, select: { id: true } });
		const externalGroups = claimedGroupIds.length === 0 ? [] : await this.prisma.group.findMany({ where: { siloId, id: { in: [...claimedGroupIds] }, membershipAuthority: "External" }, select: { id: true } });
		const externalIds = externalGroups.map(function _Id(group) { return group.id; }).sort();
		await this.prisma.groupMembership.deleteMany({ where: { siloId, principalId: principal.id, group: { membershipAuthority: "External" }, ...(externalIds.length > 0 ? { groupId: { notIn: externalIds } } : {}) } });
		if (externalIds.length > 0) await this.prisma.groupMembership.createMany({ data: externalIds.map(function _Membership(groupId) { return { siloId, groupId, principalId: principal.id }; }), skipDuplicates: true });
		const unresolved = claimedGroupIds.filter(function _Unresolved(groupId) { return !externalIds.includes(groupId); });
		if (unresolved.length > 0) options.log.warn({ siloId, subject, groupIds: unresolved }, "OIDC group claims did not resolve to external groups in this silo");
	}
}

/** Opens one transaction for the Principal and external-membership reconciliation. */
export class PrismaGroupClaimProjectionUnitOfWork implements GroupClaimProjectionUnitOfWork
{
	/** Root Prisma client that owns transaction lifetime. */
	private readonly prisma: PrismaClient;

	/** Store the composed root client. */
	constructor(prisma: PrismaClient) { this.prisma = prisma; }

	/** Validate the trusted identity tuple before opening its projection transaction. */
	reconcile(options: MirrorGroupsOnLoginOptions): Promise<void>
	{
		const siloId = options.siloId?.trim() ?? "";
		const issuer = options.issuer?.trim() ?? "";
		const subject = options.subject?.trim() ?? "";
		if (!siloId || !issuer || !subject) return Promise.resolve();
		const ids = _ParseGroupClaims(options.groups);
		return this.prisma.$transaction(async function _Project(transaction) { return new PrismaGroupClaimProjectionRepository(transaction).reconcile(options, ids); });
	}
}
