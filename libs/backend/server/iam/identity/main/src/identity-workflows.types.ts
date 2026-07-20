import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

import type { FleetMembershipWriter } from "@opencrane/backend/server/projection";

/** Dependencies and verified identity claims used to adopt a member after login. */
export interface AdoptMemberOnLoginOptions
{
  /** Silo Prisma client for membership reads and standalone writes. */
  prisma: PrismaClient;
  /** Cluster API used to resolve the per-org identity client. */
  customApi: k8s.CustomObjectsApi | null;
  /** Namespace where a newly adopted member's workspace is seeded. */
  namespace: string;
  /** Request host whose org-scoped login established membership. */
  host: string | undefined;
  /** IdP-verified subject. */
  subject: string | undefined;
  /** IdP-verified email. */
  email: string | undefined;
  /** Fleet writer, or null when this silo owns membership locally. */
  fleetWriter: FleetMembershipWriter | null;
  /** Scoped logger. */
  log: Logger;
}

/** Dependencies and identity claims used to mirror group membership after login. */
export interface MirrorGroupsOnLoginOptions
{
  /** Silo Prisma client containing the group projection. */
  prisma: PrismaClient;
  /** IdP-verified subject. */
  subject: string | undefined;
  /** Group claims carried by the verified identity token. */
  groups: readonly string[] | undefined;
  /** Scoped logger. */
  log: Logger;
}
