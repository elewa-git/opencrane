/** Supported organizational scopes for groups. */
export type GroupRouteScope = "org" | "department" | "project" | "personal";

/** Request body used to create or update a group. */
export interface GroupWriteRequest
{
  /** Stable operator-facing group name. */
  name: string;
  /** Organizational scope represented by the group. */
  scope: GroupRouteScope;
  /** Optional operator-facing description. */
  description?: string;
  /** JSON membership list stored on the group record. */
  members?: unknown[];
}
