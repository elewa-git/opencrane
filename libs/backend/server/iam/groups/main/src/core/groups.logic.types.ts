import type { Group, GroupMembershipAuthorities } from "@opencrane/contracts";

/**
 * Carries the validated fields required to create a group in one silo.
 *
 * A parent describes hierarchy but never gives the new group inherited members or grants. The
 * membership authority decides whether this command may include direct members.
 *
 * Called by: `___GroupCreateWriteSchema` and `PrismaGroupUnitOfWork.create`.
 * @see GroupMembershipAuthorities for the ownership of direct membership rows.
 */
export interface GroupCreateCommand
{
	/** Names the group uniquely within its silo. */
	name: string;
	/** Declares whether login claims or OpenCrane operators own direct membership rows. */
	membershipAuthority: GroupMembershipAuthorities;
	/** Identifies a same-silo parent for hierarchy; `null` creates a root and never inherits members or grants. */
	parentId?: string | null;
	/** Adds an optional explanation displayed with the group. */
	description?: string;
	/** Supplies direct principal IDs for a local group; external groups reject this field. */
	members?: string[];
}

/**
 * Carries the validated fields that may change on an existing group.
 *
 * Membership authority is absent because the public update schema keeps it immutable. Supplying
 * `members` replaces direct local memberships; it never changes membership inherited from a parent
 * because group hierarchy has none.
 *
 * Called by: `___GroupUpdateWriteSchema` and `PrismaGroupUnitOfWork.update`.
 * @see GroupCreateCommand for the authority and hierarchy rules shared with creation.
 */
export interface GroupUpdateCommand
{
	/** Replaces the group name inside its silo when supplied. */
	name?: string;
	/** Replaces the same-silo hierarchy parent; `null` makes the group a root. */
	parentId?: string | null;
	/** Replaces the displayed explanation when supplied. */
	description?: string;
	/** Replaces every direct principal membership for a local group; external groups reject it. */
	members?: string[];
}

/**
 * Names the shared `Group` response returned by the HTTP routes.
 *
 * Keeping this alias makes the route layer use the same contract as the generated API client,
 * including the direct-membership and hierarchy fields.
 *
 * Called by: {@link GroupRepository}, `PrismaGroupUnitOfWork`, and the groups routes.
 * @see Group in `@opencrane/contracts` for the wire shape.
 */
export type GroupResponse = Group;

/**
 * Reports the group ID and the mutation that committed.
 *
 * A mutation returns this small shape instead of a group because a delete leaves no group to
 * return. The `status` tells a caller whether the ID was created, updated, or deleted.
 *
 * Called by: {@link GroupRepository}, `PrismaGroupUnitOfWork`, and the groups router.
 * @see GroupResponse for the shape returned by reads.
 */
export interface GroupMutationResponse
{
	/** Identifies the group the committed mutation created, updated, or deleted. */
	id: string;
	/** States which mutation committed for `id`. */
	status: "created" | "updated" | "deleted";
}

/**
 * Defines silo-scoped group reads and mutations for the route after it resolves the caller's silo.
 *
 * An implementation must return direct memberships and keep every group, parent, and principal
 * lookup inside that silo. Mutation errors let the route report not-found and ownership conflicts
 * without exposing persistence details.
 *
 * Called by: `PrismaGroupUnitOfWork`, which delegates each transaction to `PrismaGroupRepository`.
 * @see GroupMutationResponse for the write result sent to HTTP clients.
 */
export interface GroupRepository
{
	/** Lists the silo's groups and their direct memberships. */
	list(siloId: string): Promise<GroupResponse[]>;
	/** Reads the group when it belongs to `siloId`, otherwise returns `null`. */
	get(siloId: string, groupId: string): Promise<GroupResponse | null>;
	/** Creates a group and returns its ID with the `created` status. */
	create(siloId: string, body: GroupCreateCommand): Promise<GroupMutationResponse>;
	/** Updates a group and returns its ID with the `updated` status. */
	update(siloId: string, groupId: string, body: GroupUpdateCommand): Promise<GroupMutationResponse>;
	/** Deletes a group and returns its ID with the `deleted` status. */
	delete(siloId: string, groupId: string): Promise<GroupMutationResponse>;
}
