import type { Grant, Group } from "@opencrane/contracts";

/** Shared response contract returned by the groups routes. */
export type GroupResponse = Group;

/** Shared grant contract returned for normalized group grants. */
export type GroupGrantResponse = Grant;

/** Persist response shape returned after create, update, or delete mutations. */
export interface GroupMutationResponse
{
  /** Stable group identifier. */
  id: string;
  /** Mutation outcome label. */
  status: "created" | "updated" | "deleted";
}
