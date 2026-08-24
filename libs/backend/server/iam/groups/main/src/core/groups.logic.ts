import { Prisma, type PrismaClient } from "@prisma/client";

import { GroupMembershipAuthorities } from "@opencrane/contracts";

import type { GroupCreateCommand, GroupMutationResponse, GroupRepository, GroupResponse, GroupUpdateCommand } from "./groups.logic.types";

/** Holds the fields that become one group-management response. */
interface _GroupRow
{
	/** Stable group identifier. */
	id: string;
	/** Silo that owns the group. */
	siloId: string;
	/** Operator-facing group name. */
	name: string;
	/** Optional structural parent. */
	parentId: string | null;
	/** Membership authority stored by Prisma. */
	membershipAuthority: string;
	/** Optional operator-facing description. */
	description: string | null;
	/** Direct normalized membership rows. */
	memberships: Array<{ principalId: string }>;
}

/** Selects the group and direct-membership fields that the management API returns. */
const _GROUP_RESPONSE_SELECT = {
	id: true,
	siloId: true,
	name: true,
	parentId: true,
	membershipAuthority: true,
	description: true,
	memberships: { select: { principalId: true }, orderBy: { principalId: "asc" as const } },
};

/**
 * Signals that an update or delete did not find the requested group in the caller's silo.
 *
 * Called by: `PrismaGroupRepository.update` and `PrismaGroupRepository.delete`.
 * @see groupsRouter in `../routes/groups.ts` for HTTP error mapping.
 */
export class GroupNotFoundError extends Error {}

/**
 * Signals a direct-membership write to a group whose login claims own those rows.
 *
 * Called by: `PrismaGroupRepository.create` and `PrismaGroupRepository.update`.
 * @see GroupMembershipAuthorities.External
 */
export class ExternalGroupMembershipMutationError extends Error {}

/**
 * Signals that a requested parent group or principal is outside the caller's silo.
 *
 * Called by: `PrismaGroupRepository._RequireReferences`.
 * @see groupsRouter in `../routes/groups.ts` for HTTP error mapping.
 */
export class GroupReferenceNotFoundError extends Error {}

/**
 * Persists silo-bound group hierarchy and direct memberships with one transaction client.
 *
 * The unit of work provides that client so a mutation and its audit entry commit or roll back
 * together. The database owns hierarchy-cycle and restricted-delete rules.
 *
 * Called by: `PrismaGroupUnitOfWork._WithRepository`.
 * @see GroupRepository for the route-facing persistence contract.
 */
export class PrismaGroupRepository implements GroupRepository
{
	/** Prisma transaction client for one group operation. */
	private readonly prisma: Prisma.TransactionClient;

	/** Stores the transaction client that owns every repository operation. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/**
	 * Lists the groups and direct memberships owned by one silo.
	 *
	 * Called by: `PrismaGroupUnitOfWork.list`.
	 * @see GroupRepository.list
	 */
	async list(siloId: string): Promise<GroupResponse[]>
	{
		const groups = await this.prisma.group.findMany({ where: { siloId }, select: _GROUP_RESPONSE_SELECT, orderBy: { createdAt: "desc" } });

		return groups.map(function _MapListedGroup(group)
		{
			return _MapGroupResponse(group as _GroupRow);
		});
	}

	/**
	 * Reads a group only when its ID belongs to the requested silo.
	 *
	 * Called by: `PrismaGroupUnitOfWork.get`.
	 * @see GroupRepository.get for the `null` not-found result.
	 */
	async get(siloId: string, groupId: string): Promise<GroupResponse | null>
	{
		const group = await this.prisma.group.findFirst({ where: { id: groupId, siloId }, select: _GROUP_RESPONSE_SELECT });
		if (!group)
		{
			return null;
		}

		return _MapGroupResponse(group as _GroupRow);
	}

	/**
	 * Creates a silo-bound group, its local direct memberships, and its audit entry.
	 *
	 * Called by: `PrismaGroupUnitOfWork.create`.
	 * @see GroupRepository.create for the route-facing result.
	 */
	async create(siloId: string, body: GroupCreateCommand): Promise<GroupMutationResponse>
	{
		const memberIds = _NormalizeMemberIds(body.members);
		const setsExternalMembership = body.members !== undefined && body.membershipAuthority === GroupMembershipAuthorities.External;
		if (setsExternalMembership)
		{
			throw new ExternalGroupMembershipMutationError("External group membership comes from login claims");
		}

		const transaction = this.prisma;
		// The silo-bound checks prevent parent and membership rows from crossing tenant boundaries.
		await PrismaGroupRepository._RequireReferences(transaction, siloId, body.parentId, memberIds);

		const groupData = {
			siloId,
			name: body.name,
			membershipAuthority: _ToPrismaMembershipAuthority(body.membershipAuthority),
			parentId: body.parentId ?? null,
			...(body.description === undefined ? {} : { description: body.description }),
		};
		const created = await transaction.group.create({ data: groupData });

		const membershipRows = _MembershipRows(siloId, created.id, memberIds);
		if (membershipRows.length > 0)
		{
			await transaction.groupMembership.createMany({ data: membershipRows });
		}

		const auditData = {
			action: "Created",
			resource: `Group/${created.id}`,
			message: `Group ${created.name} created in silo ${siloId}`,
		};
		await transaction.auditEntry.create({ data: auditData });

		return { id: created.id, status: "created" as const };
	}

	/**
	 * Updates a group and replaces its direct local memberships when they are supplied.
	 *
	 * Parents describe hierarchy only; they never inherit members or grants. External groups reject
	 * direct membership changes because identity projection owns those rows.
	 *
	 * Called by: `PrismaGroupUnitOfWork.update`.
	 * @see GroupRepository.update for the route-facing result.
	 */
	async update(siloId: string, groupId: string, body: GroupUpdateCommand): Promise<GroupMutationResponse>
	{
		const transaction = this.prisma;
		const current = await transaction.group.findFirst({ where: { id: groupId, siloId }, select: { id: true, name: true, parentId: true, membershipAuthority: true } });
		if (!current)
		{
			throw new GroupNotFoundError("Group not found");
		}

		const setsExternalMembership = body.members !== undefined && current.membershipAuthority === "External";
		if (setsExternalMembership)
		{
			throw new ExternalGroupMembershipMutationError("External group membership comes from login claims");
		}

		const memberIds = _NormalizeMemberIds(body.members);
		await PrismaGroupRepository._RequireReferences(transaction, siloId, body.parentId, memberIds);

		const groupData: {
			name?: string;
			parentId?: string | null;
			description?: string;
		} = {};
		if (body.name !== undefined)
		{
			groupData.name = body.name;
		}
		if (body.parentId !== undefined)
		{
			groupData.parentId = body.parentId;
		}
		if (body.description !== undefined)
		{
			groupData.description = body.description;
		}

		await transaction.group.update({ where: { id: groupId }, data: groupData });

		if (body.members !== undefined)
		{
			// Replacement writes remove every direct row before inserting the normalized request set.
			await transaction.groupMembership.deleteMany({ where: { siloId, groupId } });

			const membershipRows = _MembershipRows(siloId, groupId, memberIds);
			if (membershipRows.length > 0)
			{
				await transaction.groupMembership.createMany({ data: membershipRows });
			}
		}

		const parentChange = _ParentChange(current.parentId, body.parentId);
		const auditData = {
			action: "Updated",
			resource: `Group/${groupId}`,
			message: `Group ${current.name} updated in silo ${siloId}; parent ${parentChange}`,
		};
		await transaction.auditEntry.create({ data: auditData });

		return { id: groupId, status: "updated" as const };
	}

	/**
	 * Deletes a silo-bound group and appends the deletion audit entry.
	 *
	 * Called by: `PrismaGroupUnitOfWork.delete`.
	 * @see GroupRepository.delete for the route-facing result.
	 */
	async delete(siloId: string, groupId: string): Promise<GroupMutationResponse>
	{
		const transaction = this.prisma;
		const existing = await transaction.group.findFirst({ where: { id: groupId, siloId }, select: { id: true, name: true } });
		if (!existing)
		{
			throw new GroupNotFoundError("Group not found");
		}

		await transaction.group.delete({ where: { id: groupId } });

		const auditData = {
			action: "Deleted",
			resource: `Group/${groupId}`,
			message: `Group ${existing.name} deleted from silo ${siloId}`,
		};
		await transaction.auditEntry.create({ data: auditData });

		return { id: groupId, status: "deleted" as const };
	}

	/** Validates optional parent and member references before a mutation writes them. */
	private static async _RequireReferences(prisma: Prisma.TransactionClient, siloId: string, parentId: string | null | undefined, memberIds: readonly string[]): Promise<void>
	{
		if (parentId !== undefined && parentId !== null)
		{
			const parent = await prisma.group.findFirst({ where: { id: parentId, siloId }, select: { id: true } });
			if (!parent)
			{
				throw new GroupReferenceNotFoundError("Parent group not found");
			}
		}
		if (memberIds.length === 0)
		{
			return;
		}

		const principalCount = await prisma.principal.count({ where: { siloId, id: { in: [...memberIds] } } });
		if (principalCount !== memberIds.length)
		{
			throw new GroupReferenceNotFoundError("One or more principals were not found in this silo");
		}
	}
}

/**
 * Opens one Prisma transaction and delegates the operation to a transaction-bound repository.
 *
 * The groups router constructs this unit of work after resolving the authenticated caller's silo.
 *
 * Called by: `groupsRouter` in `../routes/groups.ts` and the function entry points below.
 * @see PrismaGroupRepository for the transaction-bound implementation.
 */
export class PrismaGroupUnitOfWork implements GroupRepository
{
	/** Prisma client that creates repository transactions. */
	private readonly prisma: PrismaClient;

	/** Stores the Prisma client that opens each operation transaction. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Lists the caller's silo groups through one transaction-bound repository. */
	list(siloId: string): Promise<GroupResponse[]>
	{
		return this._WithRepository(function _List(repository)
		{
			return repository.list(siloId);
		});
	}

	/** Reads a group through one transaction-bound repository, or returns `null` when absent. */
	get(siloId: string, groupId: string): Promise<GroupResponse | null>
	{
		return this._WithRepository(function _Get(repository)
		{
			return repository.get(siloId, groupId);
		});
	}

	/** Creates the group, direct memberships, and audit entry through one transaction. */
	create(siloId: string, body: GroupCreateCommand): Promise<GroupMutationResponse>
	{
		return this._WithRepository(function _Create(repository)
		{
			return repository.create(siloId, body);
		});
	}

	/** Updates the group, direct memberships, and audit entry through one transaction. */
	update(siloId: string, groupId: string, body: GroupUpdateCommand): Promise<GroupMutationResponse>
	{
		return this._WithRepository(function _Update(repository)
		{
			return repository.update(siloId, groupId, body);
		});
	}

	/** Deletes the group and appends its audit entry through one transaction. */
	delete(siloId: string, groupId: string): Promise<GroupMutationResponse>
	{
		return this._WithRepository(function _Delete(repository)
		{
			return repository.delete(siloId, groupId);
		});
	}

	/** Binds a repository to the transaction client that Prisma passes to the callback. */
	private _WithRepository<Result>(operation: (repository: GroupRepository) => Promise<Result>): Promise<Result>
	{
		return this.prisma.$transaction(async function _Run(transaction)
		{
			const repository = new PrismaGroupRepository(transaction);
			return operation(repository);
		});
	}
}

/** Lists the groups that belong to one silo through the transaction-owning unit of work.
 *
 * Called by: package consumers that invoke the groups logic module directly.
 * @see PrismaGroupUnitOfWork.list
 */
export function listGroups(prisma: PrismaClient, siloId: string): Promise<GroupResponse[]>
{
	const groups = new PrismaGroupUnitOfWork(prisma);
	return groups.list(siloId);
}

/** Reads a group only when it belongs to the requested silo.
 *
 * Called by: package consumers that invoke the groups logic module directly.
 * @see PrismaGroupUnitOfWork.get
 */
export function getGroup(prisma: PrismaClient, siloId: string, groupId: string): Promise<GroupResponse | null>
{
	const groups = new PrismaGroupUnitOfWork(prisma);
	return groups.get(siloId, groupId);
}

/** Creates a group, its direct memberships, and its audit entry in one database transaction.
 *
 * Called by: package consumers that invoke the groups logic module directly.
 * @see PrismaGroupUnitOfWork.create
 */
export function createGroup(prisma: PrismaClient, siloId: string, body: GroupCreateCommand): Promise<GroupMutationResponse>
{
	const groups = new PrismaGroupUnitOfWork(prisma);
	return groups.create(siloId, body);
}

/** Updates a group and its direct memberships in one database transaction.
 *
 * Called by: package consumers that invoke the groups logic module directly.
 * @see PrismaGroupUnitOfWork.update
 */
export function updateGroup(prisma: PrismaClient, siloId: string, groupId: string, body: GroupUpdateCommand): Promise<GroupMutationResponse>
{
	const groups = new PrismaGroupUnitOfWork(prisma);
	return groups.update(siloId, groupId, body);
}

/** Deletes a group and records the deletion in one database transaction.
 *
 * Called by: package consumers that invoke the groups logic module directly.
 * @see PrismaGroupUnitOfWork.delete
 */
export function deleteGroup(prisma: PrismaClient, siloId: string, groupId: string): Promise<GroupMutationResponse>
{
	const groups = new PrismaGroupUnitOfWork(prisma);
	return groups.delete(siloId, groupId);
}

/** Trims, deduplicates, and sorts requested direct-member IDs before writing membership rows. */
function _NormalizeMemberIds(members: readonly string[] | undefined): string[]
{
	if (members === undefined)
	{
		return [];
	}

	const trimmedMemberIds = members.map(function _Trim(member)
	{
		return member.trim();
	});
	const presentMemberIds = trimmedMemberIds.filter(function _Present(memberId)
	{
		return memberId.length > 0;
	});
	const uniqueMemberIds = new Set(presentMemberIds);

	return Array.from(uniqueMemberIds).sort();
}

/** Maps the public membership-authority values to Prisma's generated enum names. */
function _ToPrismaMembershipAuthority(authority: GroupMembershipAuthorities): "External" | "Local"
{
	if (authority === GroupMembershipAuthorities.External)
	{
		return "External";
	}

	return "Local";
}

/** Builds one normalized membership row for each validated direct-member ID. */
function _MembershipRows(siloId: string, groupId: string, memberIds: readonly string[]): Array<{ siloId: string; groupId: string; principalId: string }>
{
	return memberIds.map(function _Membership(principalId)
	{
		return { siloId, groupId, principalId };
	});
}

/** Formats the requested hierarchy change for the audit entry. */
function _ParentChange(currentParentId: string | null, requestedParentId: string | null | undefined): string
{
	if (requestedParentId === undefined)
	{
		return "unchanged";
	}

	const currentParent = currentParentId ?? "root";
	const requestedParent = requestedParentId ?? "root";

	return `${currentParent} -> ${requestedParent}`;
}

/** Maps a persisted group and its direct memberships into the shared route contract. */
function _MapGroupResponse(group: _GroupRow): GroupResponse
{
	let authority: GroupMembershipAuthorities;
	if (group.membershipAuthority === "External")
	{
		authority = GroupMembershipAuthorities.External;
	}
	else if (group.membershipAuthority === "Local")
	{
		authority = GroupMembershipAuthorities.Local;
	}
	else
	{
		throw new Error(`Unknown group membership authority: ${group.membershipAuthority}`);
	}

	const members = group.memberships.map(function _PrincipalId(membership)
	{
		return membership.principalId;
	});

	return {
		id: group.id,
		siloId: group.siloId,
		name: group.name,
		parentId: group.parentId,
		membershipAuthority: authority,
		description: group.description ?? undefined,
		members,
		memberCount: members.length,
	};
}
