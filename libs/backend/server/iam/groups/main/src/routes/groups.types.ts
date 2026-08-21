/** Supported organizational scopes for groups. */
export type GroupRouteScope = "org" | "department" | "project" | "personal";

/** Request body used to create or update a group. */
export interface GroupWriteRequest
{
  /** Stable operator-facing group name. */
  name: string;
  /** Organizational scope represented by the group. */
  scope: GroupRouteScope;
  /** Sets a parent when present; null detaches the group, while omission preserves it during updates. */
  parentId?: string | null;
  /** Optional operator-facing description. */
  description?: string;
  /** JSON membership list stored on the group record. */
  members?: unknown[];
}
