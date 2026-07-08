/**
 * Types for the fleet → silo OrgMembership projection repairer (#126 S2).
 */

import type * as k8s from "@kubernetes/client-node";

import type { OpenClawGatewayAdmin } from "../core/connections/gateway-admin.types.js";

/**
 * The Kubernetes + gateway clients the repairer needs to ENFORCE a suspension (#126): cut the
 * member's live sessions/devices and suspend their workspace pod. Grouped so the DI wiring in
 * index.ts passes one object and standalone/no-op paths can omit it cleanly.
 */
export interface MembershipEnforcementDeps
{
  /** Custom Objects API client — patches the member's Tenant CR `spec.suspended`. */
  customApi: k8s.CustomObjectsApi;
  /** Core V1 API client — force-deletes pods on a cut (via `_CutTenant`). */
  coreApi: k8s.CoreV1Api;
  /** Gateway admin — revokes brokered device tokens/pairings on a cut. */
  gatewayAdmin: OpenClawGatewayAdmin;
  /** Namespace this silo's Tenant CRs live in (the projection-repair namespace). */
  namespace: string;
}

/** A single membership as returned by the fleet internal endpoint. */
export interface FleetMembershipRow
{
  /** IdP-verified subject (OIDC `sub`) holding the membership. */
  subject: string;
  /** Role held within the org (Owner | Admin | Member). */
  role: string;
  /** Lifecycle status (Active | Suspended); absent/unknown on the wire ⇒ treated as Active. */
  status?: string;
}

/**
 * Reader over the fleet's authoritative org membership. The default HTTP implementation
 * pulls from the fleet internal endpoint; tests inject a fake. A reader returns `null`
 * to signal "source unavailable" (unconfigured / unreachable / non-OK), which the
 * repairer treats as a safe no-op — it never wipes the local rows on an empty read it
 * cannot trust.
 */
export interface FleetMembershipReader
{
  /**
   * Read the org's authoritative memberships from the fleet, or null when the source
   * is unavailable (so the repairer no-ops rather than deleting local rows).
   *
   * @param clusterTenant - The org (ClusterTenant) whose membership to read.
   */
  read(clusterTenant: string): Promise<FleetMembershipRow[] | null>;
}
