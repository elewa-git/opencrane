import type { Grant } from "./grant.types";
import { GrantScope } from "./grant.types";

/**
 * Shared group contract returned by the opencrane-ui group APIs.
 *
 * Groups model stable domain membership sets such as organization-,
 * department-, project-, or personal-scoped cohorts. The same shape is used by
 * the API layer and the admin UI so the entitlement compiler and the renderer
 * stay aligned on what a group means.
 */
export interface Group
{
  /** Stable group identifier. */
  id: string;
  /** Human-readable group name shown to operators. */
  name: string;
  /** Domain scope represented by the group. */
  scope: GrantScope;
  /** Identifies the parent used for arrangement; ancestry does not add members or grants. */
  parentId: string | null;
  /** Optional operator-facing description. */
  description?: string;
  /** Normalized principal identifiers attached to the group. */
  members: string[];
  /** Snapshot count derived from the normalized members list. */
  memberCount: number;
  /** Grants that the opencrane-ui links to the group. */
  grants: Grant[];
}
