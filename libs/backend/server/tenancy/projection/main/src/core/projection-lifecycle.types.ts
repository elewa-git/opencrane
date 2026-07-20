import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

import type { MembershipEnforcementDeps } from "./membership-projection-repairer.types.js";

/** Dependencies and environment-derived settings for projection lifecycle assembly. */
export interface ProjectionLifecycleOptions
{
  /** Kubernetes custom-resource client used for Tenant and ClusterTenant reads. */
  customApi: k8s.CustomObjectsApi;
  /** Silo database projection client. */
  prisma: PrismaClient;
  /** Namespace whose Tenant resources feed the silo projection. */
  namespace: string;
  /** Projection sweep interval in milliseconds. */
  intervalMs: number;
  /** Fleet internal API base URL, empty in standalone mode. */
  fleetInternalUrl: string;
  /** Internal authentication token used by the fleet reader. */
  fleetInternalToken: string;
  /** Structured application logger. */
  log: Logger;
  /** App-composed tenant suspension enforcement ports. */
  enforcement: MembershipEnforcementDeps;
}
