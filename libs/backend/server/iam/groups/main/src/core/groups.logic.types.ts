import type { Group, GroupMembershipAuthorities } from "@opencrane/contracts";

/** Validated command used to create one hierarchy node. */
export interface GroupCreateCommand
{
	/** Peer-visible group name within the silo. */
	name: string;
	/** Authority allowed to reconcile direct memberships. */
	membershipAuthority: GroupMembershipAuthorities;
	/** Nullable parent Group id that defines hierarchy only, never inherited membership. */
	parentId?: string | null;
	/** Optional peer-visible explanation of the group. */
	description?: string;
	/** Direct member Principal ids; accepted only for locally curated groups. */
	members?: string[];
}

/** Validated command containing the mutable fields of one hierarchy node. */
export interface GroupUpdateCommand
{
	/** Replacement peer-visible name. */
	name?: string;
	/** Replacement nullable parent Group id. */
	parentId?: string | null;
	/** Replacement peer-visible explanation. */
	description?: string;
	/** Replacement direct member Principal ids for a locally curated group. */
	members?: string[];
}

/**
 * The group shape the HTTP routes return. An alias of the shared `Group` contract from
 * @opencrane/contracts, so the route layer and the generated API client cannot drift apart.
 */
export type GroupResponse = Group;

/**
 * What a create, update, or delete returns: the group's id, plus which of the three happened.
 *
 * Deliberately not the group itself — a delete has no group left to return, so all three share one
 * shape.
 *
 * Called by: createGroup, updateGroup, and deleteGroup in core/groups.logic.ts, whose values the
 * groups router sends as JSON.
 */
export interface GroupMutationResponse
{
  /** Stable group identifier. */
  id: string;
  /** Mutation outcome label. */
	status: "created" | "updated" | "deleted";
}

/** Persistence contract consumed by the HTTP route after it resolves the caller's silo. */
export interface GroupRepository
{
	/** Lists groups inside one silo. */
	list(siloId: string): Promise<GroupResponse[]>;
	/** Reads one silo-bound group. */
	get(siloId: string, groupId: string): Promise<GroupResponse | null>;
	/** Creates one silo-bound group. */
	create(siloId: string, body: GroupCreateCommand): Promise<GroupMutationResponse>;
	/** Updates one silo-bound group. */
	update(siloId: string, groupId: string, body: GroupUpdateCommand): Promise<GroupMutationResponse>;
	/** Deletes one silo-bound group. */
	delete(siloId: string, groupId: string): Promise<GroupMutationResponse>;
}
