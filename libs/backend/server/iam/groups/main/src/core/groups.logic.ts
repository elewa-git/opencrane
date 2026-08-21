import { Prisma, type PrismaClient } from "@prisma/client";

import { GroupMembershipAuthorities } from "@opencrane/contracts";

import type { GroupCreateCommand, GroupMutationResponse, GroupRepository, GroupResponse, GroupUpdateCommand } from "./groups.logic.types";

/** Persisted group projection needed by the management API. */
interface _GroupRow
{
	/** Stable group identifier. */
	id: string;
	/** Silo that owns the group. */
	siloId: string;
	/** Operator-facing group name. */
	name: string;
	/** Optional hierarchy parent. */
	parentId: string | null;
	/** Membership authority stored by Prisma. */
	membershipAuthority: string;
	/** Optional operator-facing description. */
	description: string | null;
	/** Direct normalized membership rows. */
	memberships: Array<{ principalId: string }>;
}

/** Selects the fields needed by every group response. */
const _GROUP_RESPONSE_SELECT = { id: true, siloId: true, name: true, parentId: true, membershipAuthority: true, description: true, memberships: { select: { principalId: true }, orderBy: { principalId: "asc" as const } } };

/** Raised when a silo-scoped group mutation cannot find its target. */
export class GroupNotFoundError extends Error {}

/** Raised when a request tries to mutate membership owned by the identity provider. */
export class ExternalGroupMembershipMutationError extends Error {}

/** Raised when a request names a principal or parent outside the caller's silo. */
export class GroupReferenceNotFoundError extends Error {}

/** Prisma-backed transaction boundary for group hierarchy and normalized membership changes. */
export class PrismaGroupRepository implements GroupRepository
{
	/** Prisma client for the silo product database. */
	private readonly prisma: Prisma.TransactionClient;

	/** Store the composed Prisma client used by every repository method. */
	constructor(prisma: Prisma.TransactionClient) { this.prisma = prisma; }

	/** List groups inside one silo. */
	async list(siloId: string): Promise<GroupResponse[]>
	{
		const groups = await this.prisma.group.findMany({ where: { siloId }, select: _GROUP_RESPONSE_SELECT, orderBy: { createdAt: "desc" } });
		return groups.map(function _MapListedGroup(group) { return _MapGroupResponse(group as _GroupRow); });
	}

	/** Read one silo-bound group. */
	async get(siloId: string, groupId: string): Promise<GroupResponse | null>
	{
		const group = await this.prisma.group.findFirst({ where: { id: groupId, siloId }, select: _GROUP_RESPONSE_SELECT });
		return group ? _MapGroupResponse(group as _GroupRow) : null;
	}

	/** Create one silo-bound group. */
	async create(siloId: string, body: GroupCreateCommand): Promise<GroupMutationResponse>
	{
		const memberIds = _NormalizeMemberIds(body.members);
		if (body.members !== undefined && body.membershipAuthority === GroupMembershipAuthorities.External) throw new ExternalGroupMembershipMutationError("External group membership comes from login claims");
		const transaction = this.prisma;
			await PrismaGroupRepository._RequireReferences(transaction, siloId, body.parentId, memberIds);
			const created = await transaction.group.create({ data: { siloId, name: body.name, membershipAuthority: _ToPrismaMembershipAuthority(body.membershipAuthority), parentId: body.parentId ?? null, ...(body.description !== undefined ? { description: body.description } : {}) } });
			if (memberIds.length > 0) await transaction.groupMembership.createMany({ data: memberIds.map(function _Membership(principalId) { return { siloId, groupId: created.id, principalId }; }) });
			await transaction.auditEntry.create({ data: { action: "Created", resource: `Group/${created.id}`, message: `Group ${created.name} created in silo ${siloId}` } });
		return { id: created.id, status: "created" as const };
	}

	/** Update one silo-bound group. */
	async update(siloId: string, groupId: string, body: GroupUpdateCommand): Promise<GroupMutationResponse>
	{
		const transaction = this.prisma;
			const current = await transaction.group.findFirst({ where: { id: groupId, siloId }, select: { id: true, name: true, parentId: true, membershipAuthority: true } });
			if (!current) throw new GroupNotFoundError("Group not found");
			if (body.members !== undefined && current.membershipAuthority === "External") throw new ExternalGroupMembershipMutationError("External group membership comes from login claims");
			const memberIds = _NormalizeMemberIds(body.members);
			await PrismaGroupRepository._RequireReferences(transaction, siloId, body.parentId, memberIds);
			const data: { name?: string; parentId?: string | null; description?: string } = {};
			if (body.name !== undefined) data.name = body.name;
			if (body.parentId !== undefined) data.parentId = body.parentId;
			if (body.description !== undefined) data.description = body.description;
			await transaction.group.update({ where: { id: groupId }, data });
			if (body.members !== undefined)
			{
				await transaction.groupMembership.deleteMany({ where: { siloId, groupId } });
				if (memberIds.length > 0) await transaction.groupMembership.createMany({ data: memberIds.map(function _Membership(principalId) { return { siloId, groupId, principalId }; }) });
			}
			const parentChange = body.parentId === undefined ? "unchanged" : `${current.parentId ?? "root"} -> ${body.parentId ?? "root"}`;
			await transaction.auditEntry.create({ data: { action: "Updated", resource: `Group/${groupId}`, message: `Group ${current.name} updated in silo ${siloId}; parent ${parentChange}` } });
		return { id: groupId, status: "updated" as const };
	}

	/** Delete one silo-bound group. */
	async delete(siloId: string, groupId: string): Promise<GroupMutationResponse>
	{
		const transaction = this.prisma;
			const existing = await transaction.group.findFirst({ where: { id: groupId, siloId }, select: { id: true, name: true } });
			if (!existing) throw new GroupNotFoundError("Group not found");
			await transaction.group.delete({ where: { id: groupId } });
			await transaction.auditEntry.create({ data: { action: "Deleted", resource: `Group/${groupId}`, message: `Group ${existing.name} deleted from silo ${siloId}` } });
		return { id: groupId, status: "deleted" as const };
	}

	/** Validate that optional parent and member references belong to the same silo. */
	private static async _RequireReferences(prisma: Prisma.TransactionClient, siloId: string, parentId: string | null | undefined, memberIds: readonly string[]): Promise<void>
	{
		if (parentId)
		{
			const parent = await prisma.group.findFirst({ where: { id: parentId, siloId }, select: { id: true } });
			if (!parent) throw new GroupReferenceNotFoundError("Parent group not found");
		}
		if (memberIds.length === 0) return;
		const count = await prisma.principal.count({ where: { siloId, id: { in: [...memberIds] } } });
		if (count !== memberIds.length) throw new GroupReferenceNotFoundError("One or more principals were not found in this silo");
	}
}

/** Opens one database transaction around every group mutation. */
export class PrismaGroupUnitOfWork implements GroupRepository
{
	/** Prisma client that owns transaction creation. */
	private readonly prisma: PrismaClient;

	/** Store the composed Prisma client. */
	constructor(prisma: PrismaClient) { this.prisma = prisma; }

	/** Read the current silo without opening a write transaction. */
	list(siloId: string): Promise<GroupResponse[]> { return this._WithRepository(function _List(repository) { return repository.list(siloId); }); }

	/** Read one current group without opening a write transaction. */
	get(siloId: string, groupId: string): Promise<GroupResponse | null> { return this._WithRepository(function _Get(repository) { return repository.get(siloId, groupId); }); }

	/** Create the group, memberships, and audit record atomically. */
	create(siloId: string, body: GroupCreateCommand): Promise<GroupMutationResponse>
	{
		return this._WithRepository(function _Create(repository) { return repository.create(siloId, body); });
	}

	/** Update the group, memberships, and audit record atomically. */
	update(siloId: string, groupId: string, body: GroupUpdateCommand): Promise<GroupMutationResponse>
	{
		return this._WithRepository(function _Update(repository) { return repository.update(siloId, groupId, body); });
	}

	/** Delete the group and append its audit record atomically. */
	delete(siloId: string, groupId: string): Promise<GroupMutationResponse>
	{
		return this._WithRepository(function _Delete(repository) { return repository.delete(siloId, groupId); });
	}

	/** Open one transaction and bind the repository to that transaction. */
	private _WithRepository<Result>(operation: (repository: GroupRepository) => Promise<Result>): Promise<Result>
	{
		return this.prisma.$transaction(async function _Run(transaction) { return operation(new PrismaGroupRepository(transaction)); });
	}
}

/** Load every group in one silo through the Prisma adapter. */
export function listGroups(prisma: PrismaClient, siloId: string): Promise<GroupResponse[]> { return new PrismaGroupUnitOfWork(prisma).list(siloId); }

/** Load one group through the Prisma adapter. */
export function getGroup(prisma: PrismaClient, siloId: string, groupId: string): Promise<GroupResponse | null> { return new PrismaGroupUnitOfWork(prisma).get(siloId, groupId); }

/** Create one group through the Prisma adapter. */
export function createGroup(prisma: PrismaClient, siloId: string, body: GroupCreateCommand): Promise<GroupMutationResponse> { return new PrismaGroupUnitOfWork(prisma).create(siloId, body); }

/** Update one group through the Prisma adapter. */
export function updateGroup(prisma: PrismaClient, siloId: string, groupId: string, body: GroupUpdateCommand): Promise<GroupMutationResponse> { return new PrismaGroupUnitOfWork(prisma).update(siloId, groupId, body); }

/** Delete one group through the Prisma adapter. */
export function deleteGroup(prisma: PrismaClient, siloId: string, groupId: string): Promise<GroupMutationResponse> { return new PrismaGroupUnitOfWork(prisma).delete(siloId, groupId); }

/** Normalize direct memberships into distinct Principal IDs. */
function _NormalizeMemberIds(members: readonly string[] | undefined): string[]
{
	if (members === undefined) return [];
	return Array.from(new Set(members.map(function _Trim(member) { return member.trim(); }).filter(function _Present(member) { return member.length > 0; }))).sort();
}

/** Map the public lowercase vocabulary to Prisma's enum names. */
function _ToPrismaMembershipAuthority(authority: GroupMembershipAuthorities): "External" | "Local" { return authority === GroupMembershipAuthorities.External ? "External" : "Local"; }

/** Map one persisted group and its normalized memberships into the route contract. */
function _MapGroupResponse(group: _GroupRow): GroupResponse
{
	let authority: GroupMembershipAuthorities;
	if (group.membershipAuthority === "External") authority = GroupMembershipAuthorities.External;
	else if (group.membershipAuthority === "Local") authority = GroupMembershipAuthorities.Local;
	else throw new Error(`Unknown group membership authority: ${group.membershipAuthority}`);
	const members = group.memberships.map(function _PrincipalId(membership) { return membership.principalId; });
	return { id: group.id, siloId: group.siloId, name: group.name, parentId: group.parentId, membershipAuthority: authority, description: group.description ?? undefined, members, memberCount: members.length };
}
