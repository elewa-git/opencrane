import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

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
