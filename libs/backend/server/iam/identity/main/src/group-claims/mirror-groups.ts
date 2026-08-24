import { GroupMembershipAuthority, Prisma, type PrismaClient } from "@prisma/client";

import type { GroupClaimProjectionCommand, GroupClaimProjectionRepository, GroupClaimProjectionUnitOfWork, MirrorGroupsOnLoginOptions } from "./identity-workflows.types";

/** Stable prefix used by Zitadel roles that refer to an existing OpenCrane Group ID. */
const _GROUP_CLAIM_PREFIX = "group:";

/** Parse claims that contain one opaque stable Group ID segment. */
export function _ParseGroupClaims(groups: readonly string[] | undefined): string[]
{
	const ids = new Set<string>();
	for (const raw of groups ?? [])
	{
		if (typeof raw !== "string")
			continue;
		const claim = raw.trim();
		if (!claim.startsWith(_GROUP_CLAIM_PREFIX))
			continue;
		const id = claim.slice(_GROUP_CLAIM_PREFIX.length);
		if (id.length === 0 || id.includes(":"))
			continue;
		ids.add(id);
	}
	return Array.from(ids).sort();
}

/** Validates the identity tuple once and prepares the transaction command. */
function _projectionCommand(options: MirrorGroupsOnLoginOptions): GroupClaimProjectionCommand | null
{
	// 1. Trim the identity coordinates because they become the Principal's stable lookup key.
	const siloId = options.siloId?.trim() ?? "";
	const issuer = options.issuer?.trim() ?? "";
	const subject = options.subject?.trim() ?? "";

	// 2. Refuse incomplete identities before opening a database transaction.
	if (!siloId || !issuer || !subject)
		return null;

	// 3. Parse the verified claims once, so the repository receives only stable group IDs.
	return { siloId, issuer, subject, email: options.email, displayName: options.displayName, groupIds: _ParseGroupClaims(options.groups), log: options.log };
}

/**
 * Replaces one Principal's login-owned group memberships inside the caller's transaction.
 *
 * The unit of work validates the identity and parses group claims before constructing this adapter.
 * The adapter owns the transaction-scoped projection and reports claims that did not resolve;
 * identity validation and claim parsing stay outside the database workflow.
 *
 * Called by: `PrismaGroupClaimProjectionUnitOfWork.reconcile` in this file.
 * @see GroupClaimProjectionRepository for the transaction-scoped contract.
 */
class PrismaGroupClaimProjectionRepository implements GroupClaimProjectionRepository
{
	/** Transaction-scoped Prisma surface. */
	private readonly prisma: Prisma.TransactionClient;

	/** Stores the transaction supplied by the unit of work. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/** Projects the Principal and replaces only direct external memberships. */
	async reconcile(command: GroupClaimProjectionCommand): Promise<void>
	{
		const { siloId, issuer, subject } = command;

		// 1. Upsert the verified identity before writing memberships that reference its Principal.
		const create: Prisma.PrincipalUncheckedCreateInput = { siloId, issuer, subject };
		if (command.email)
			create.email = command.email;
		if (command.displayName)
			create.displayName = command.displayName;
		const principal = await this.prisma.principal.upsert({ where: { siloId_issuer_subject: { siloId, issuer, subject } }, create, update: { email: command.email ?? null, displayName: command.displayName ?? null }, select: { id: true } });

		// 2. Resolve claims only to existing external groups, so login never creates or takes over groups.
		let externalGroups: readonly { id: string }[] = [];
		if (command.groupIds.length > 0)
			externalGroups = await this.prisma.group.findMany({ where: { siloId, id: { in: [...command.groupIds] }, membershipAuthority: GroupMembershipAuthority.External }, select: { id: true } });
		const externalIds = externalGroups.map(function _Id(group) { return group.id; }).sort();

		// 3. Replace login-owned memberships while the relation filter protects locally managed rows.
		const deleteWhere: Prisma.GroupMembershipWhereInput = { siloId, principalId: principal.id, group: { membershipAuthority: GroupMembershipAuthority.External } };
		if (externalIds.length > 0)
			deleteWhere.groupId = { notIn: externalIds };
		await this.prisma.groupMembership.deleteMany({ where: deleteWhere });
		if (externalIds.length > 0)
			await this.prisma.groupMembership.createMany({ data: externalIds.map(function _Membership(groupId) { return { siloId, groupId, principalId: principal.id }; }), skipDuplicates: true });

		// 4. Warn about unknown or local group IDs because neither may become login-owned membership.
		const resolvedIds = new Set(externalIds);
		const unresolved = command.groupIds.filter(function _Unresolved(groupId) { return !resolvedIds.has(groupId); });
		if (unresolved.length > 0)
			command.log.warn({ siloId, subject, groupIds: unresolved }, "OIDC group claims did not resolve to external groups in this silo");
	}
}

/** Opens one transaction for the Principal and external-membership reconciliation. */
export class PrismaGroupClaimProjectionUnitOfWork implements GroupClaimProjectionUnitOfWork
{
	/** Root Prisma client that owns transaction lifetime. */
	private readonly prisma: PrismaClient;

	/** Stores the composed root client. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Validate the trusted identity tuple before opening its projection transaction. */
	reconcile(options: MirrorGroupsOnLoginOptions): Promise<void>
	{
		const command = _projectionCommand(options);
		if (command === null)
			return Promise.resolve();
		return this.prisma.$transaction(async function _Project(transaction)
		{
			const repository = new PrismaGroupClaimProjectionRepository(transaction);
			return repository.reconcile(command);
		});
	}
}
