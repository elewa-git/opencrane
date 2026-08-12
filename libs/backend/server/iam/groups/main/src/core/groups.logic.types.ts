import type { Group } from "@opencrane/contracts";

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
