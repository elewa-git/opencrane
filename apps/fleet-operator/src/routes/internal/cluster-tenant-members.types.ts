/**
 * Types for the fleet → silo org-membership projection source (#126 S2).
 */

/** One org-membership row as exposed to the silo projection repairer. */
export interface InternalOrgMembershipView
{
  /** IdP-verified subject (OIDC `sub`) holding the membership. */
  subject: string;
  /** Role held within the organisation (Owner | Admin | Member). */
  role: string;
  /** Lifecycle status (Active | Suspended). The silo repairer enforces suspension off this. */
  status: string;
}
