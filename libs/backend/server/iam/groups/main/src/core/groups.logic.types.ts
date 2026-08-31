import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import type { Group, GroupMembershipAuthorities } from "@opencrane/contracts";

/** Authenticated local Principal that requests one group operation. */
export interface GroupOperationCaller
{
	/** Silo derived from the trusted request host. */
	readonly siloId: string;
	/** Durable local Principal admitted by authentication middleware. */
	readonly principalId: string;
}

/** Constructs the central authority over the transaction that owns a group operation. */
export type GroupAuthorizationAuthorityFactory<Transaction> = (transaction: Transaction) => AuthorizationAuthority;

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
	/** Lists the groups the current Principal may read. */
	list(caller: GroupOperationCaller): Promise<GroupResponse[]>;
	/** Reads the group when it belongs to the silo and the Principal may read it. */
	get(caller: GroupOperationCaller, groupId: string): Promise<GroupResponse | null>;
	/** Creates a group after atomically admitting the collection-level create action. */
	create(caller: GroupOperationCaller, body: GroupCreateCommand): Promise<GroupMutationResponse>;
	/** Updates a group after atomically admitting the exact resource action. */
	update(caller: GroupOperationCaller, groupId: string, body: GroupUpdateCommand): Promise<GroupMutationResponse>;
	/** Deletes a group after atomically admitting the exact resource action. */
	delete(caller: GroupOperationCaller, groupId: string): Promise<GroupMutationResponse>;
}

/** Transaction-scoped persistence port used after the UnitOfWork owns authorization. */
export interface GroupTransactionRepository
{
	/** Lists lifecycle-eligible groups inside one silo. */
	list(siloId: string): Promise<GroupResponse[]>;
	/** Reads one lifecycle-eligible group inside one silo. */
	get(siloId: string, groupId: string): Promise<GroupResponse | null>;
	/** Creates one already-admitted group. */
	create(siloId: string, body: GroupCreateCommand): Promise<GroupMutationResponse>;
	/** Updates one already-admitted group. */
	update(siloId: string, groupId: string, body: GroupUpdateCommand): Promise<GroupMutationResponse>;
	/** Deletes one already-admitted group. */
	delete(siloId: string, groupId: string): Promise<GroupMutationResponse>;
}
