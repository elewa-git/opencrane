import { Prisma, type PrismaClient } from "@prisma/client";

import { GrantScope } from "@opencrane/contracts";
import { ___SortBy } from "@opencrane/util";

import type { GroupMutationResponse, GroupResponse } from "./groups.logic.types";
import type { GroupRouteScope, GroupWriteRequest } from "../routes/groups.types";

type _GroupRow = Prisma.GroupGetPayload<{}>;

/** Route scope string ("org", "department", …) to the value stored in the group's scope column. */
const _PRISMA_SCOPE_BY_ROUTE_SCOPE = {
	org: "Org",
	department: "Department",
	project: "Project",
	personal: "Personal",
};

/** The reverse: stored scope value to the GrantScope the API returns (includes Team, which routes cannot set). */
const _ROUTE_SCOPE_BY_PRISMA_SCOPE: Record<string, GrantScope> = {
	Org: GrantScope.Org,
	Department: GrantScope.Department,
	Team: GrantScope.Team,
	Project: GrantScope.Project,
	Personal: GrantScope.Personal,
};

/**
 * Load every group in the silo, newest first.
 *
 * There is no paging and no scope filter: a silo's group list is operator-sized. `grants` comes back
 * empty — this loads groups only.
 *
 * Called by: the GET / handler of groupsRouter in routes/groups.ts.
 * @param prisma - Silo Prisma client.
 * @returns One row per group, with members de-duplicated, sorted, and counted.
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
 * Create a group and record it in the audit-entry table.
 *
 * The two writes are not one transaction, so a failed audit insert still leaves the group created —
 * this is the operator-facing group list, not the append-only authorization decision log.
 *
 * Called by: the POST / handler of groupsRouter in routes/groups.ts.
 * @param prisma - Silo Prisma client.
 * @param body - Name, scope, optional description, and raw member list from the request.
 * @returns The new group's id with status `created`.
 * @throws Error from Prisma when the group name is already taken (unique constraint).
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
 * Delete a group and record it in the audit-entry table.
 *
 * Called by: the DELETE /:id handler of groupsRouter in routes/groups.ts.
 * @param prisma - Silo Prisma client.
 * @param groupId - Group identifier from the route path.
 * @returns The id with status `deleted`.
 * @throws Error from Prisma when no group has that id.
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
 * Turn a raw membership value into a de-duplicated, sorted list of non-empty strings.
 *
 * Used both on the way in and on the way out, so a hand-edited or legacy `members` column still
 * reads back as a clean list. Non-strings and blanks are dropped, not kept.
 *
 * @param members - Raw value from the request body or the database column.
 * @returns Sorted, unique member identifiers.
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
