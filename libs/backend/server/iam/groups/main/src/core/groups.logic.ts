import { Prisma, type PrismaClient } from "@prisma/client";

import { GrantScope } from "@opencrane/contracts";
import { ___SortBy } from "@opencrane/util";

import type { GroupMutationResponse, GroupResponse } from "./groups.logic.types.js";
import type { GroupRouteScope, GroupWriteRequest } from "../routes/groups.types.js";

type _GroupRow = Prisma.GroupGetPayload<{}>;

/** Prisma scope lookup keyed by route values. */
const _PRISMA_SCOPE_BY_ROUTE_SCOPE = {
	org: "Org",
	department: "Department",
	project: "Project",
	personal: "Personal",
};

/** Route scope lookup keyed by Prisma enum values. */
const _ROUTE_SCOPE_BY_PRISMA_SCOPE: Record<string, GrantScope> = {
	Org: GrantScope.Org,
	Department: GrantScope.Department,
	Team: GrantScope.Team,
	Project: GrantScope.Project,
	Personal: GrantScope.Personal,
};

/**
 * Load every persisted group.
 *
 * @param prisma - Prisma client used for persistence.
 * @returns Normalized route response rows.
 */
export async function listGroups(prisma: PrismaClient): Promise<GroupResponse[]>
{
	const groups = await prisma.group.findMany({
		orderBy: { createdAt: "desc" },
	});

	return groups.map(function _mapGroup(group)
	{
		return _MapGroupResponse(group);
	});
}

/**
 * Load a single persisted group.
 *
 * @param prisma - Prisma client used for persistence.
 * @param groupId - Group identifier from the route.
 * @returns Normalized response or null when the group does not exist.
 */
export async function getGroup(prisma: PrismaClient, groupId: string): Promise<GroupResponse | null>
{
	const group = await prisma.group.findUnique({
		where: { id: groupId },
	});

	return group ? _MapGroupResponse(group) : null;
}

/**
 * Create a group.
 *
 * @param prisma - Prisma client used for persistence.
 * @param body - Route payload provided by the caller.
 * @returns Mutation response consumed by the route.
 */
export async function createGroup(prisma: PrismaClient, body: GroupWriteRequest): Promise<GroupMutationResponse>
{
	const members = _NormalizeMembers(body.members);

	const createdGroup = await prisma.group.create({
		data: {
			name: body.name,
			scope: _PRISMA_SCOPE_BY_ROUTE_SCOPE[body.scope] as Prisma.GroupCreateInput["scope"],
			...(body.description ? { description: body.description } : {}),
			members: members as Prisma.InputJsonValue,
		},
	});

	await prisma.auditEntry.create({
		data: {
			action: "Created",
			resource: `Group/${createdGroup.id}`,
			message: `Group ${createdGroup.name} created`,
		},
	});

	return { id: createdGroup.id, status: "created" };
}

/**
 * Update a group.
 *
 * @param prisma - Prisma client used for persistence.
 * @param groupId - Group identifier from the route.
 * @param body - Partial route payload provided by the caller.
 * @returns Mutation response consumed by the route.
 */
export async function updateGroup(prisma: PrismaClient, groupId: string, body: Partial<GroupWriteRequest>): Promise<GroupMutationResponse>
{
	const members = body.members ? _NormalizeMembers(body.members) : undefined;

	await prisma.group.update({
		where: { id: groupId },
		data: {
			...(body.name ? { name: body.name } : {}),
			...(body.scope ? { scope: _PRISMA_SCOPE_BY_ROUTE_SCOPE[body.scope] as Prisma.GroupUpdateInput["scope"] } : {}),
			...(body.description !== undefined ? { description: body.description } : {}),
			...(members ? { members: members as Prisma.InputJsonValue } : {}),
		},
	});

	await prisma.auditEntry.create({
		data: {
			action: "Updated",
			resource: `Group/${groupId}`,
			message: `Group ${groupId} updated`,
		},
	});

	return { id: groupId, status: "updated" };
}

/**
 * Delete a group.
 *
 * @param prisma - Prisma client used for persistence.
 * @param groupId - Group identifier from the route.
 * @returns Mutation response consumed by the route.
 */
export async function deleteGroup(prisma: PrismaClient, groupId: string): Promise<GroupMutationResponse>
{
	await prisma.group.delete({
		where: { id: groupId },
	});

	await prisma.auditEntry.create({
		data: {
			action: "Deleted",
			resource: `Group/${groupId}`,
			message: `Group ${groupId} deleted`,
		},
	});

	return { id: groupId, status: "deleted" };
}

/**
 * Normalize raw membership JSON into a unique, sorted string array.
 *
 * @param members - Raw request or database membership value.
 * @returns Canonical principal identifier list.
 */
function _NormalizeMembers(members: unknown): string[]
{
	if (!Array.isArray(members))
	{
		return [];
	}

	const uniqueMembers = new Set<string>();
	for (const member of members)
	{
		if (typeof member !== "string")
		{
			continue;
		}

		const normalizedMember = member.trim();
		if (normalizedMember.length === 0)
		{
			continue;
		}

		uniqueMembers.add(normalizedMember);
	}

	return ___SortBy(Array.from(uniqueMembers));
}

/**
 * Map a persisted group into the route response shape.
 *
 * @param group - Persisted group row.
 * @returns Normalized response payload.
 */
function _MapGroupResponse(group: _GroupRow): GroupResponse
{
	const members = _NormalizeMembers(group.members);

	return {
		id: group.id,
		name: group.name,
		scope: _ROUTE_SCOPE_BY_PRISMA_SCOPE[group.scope] ?? GrantScope.Personal,
		description: group.description ?? undefined,
		members,
		memberCount: members.length,
		grants: [],
	};
}
