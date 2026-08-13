import type { Request } from "express";

import { _RequestHost } from "./request-host.js";
import type { RequestPrincipal } from "./request-principal.types.js";
import { _ClusterTenantFromHost } from "./request-silo.js";

/**
 * Read the logged-in caller out of an Express request: who they are, which silo they are
 * on, and whether the session says they are an org admin.
 *
 * Both facts must be present. The identity comes from the session (`sub`, falling back to
 * the lower-cased email), and the silo comes from the first DNS label of the trusted
 * request host. Either one missing returns null, so a route can never act for "some
 * caller in no silo".
 *
 * It deliberately returns a plain identity shape rather than any domain caller type: each
 * router converts it into whatever caller type it owns, so this file needs no dependency
 * on those domains.
 *
 * Called by: prisma-personal-configuration.router.ts, prisma-persona-onboarding.router.ts,
 * prisma-steering-ingest.router.ts, and prisma-self-run-cancellation.router.ts (all under
 * libs/backend/agents), each in its own local `_resolveCaller`.
 *
 * @param request - The request, after session authentication has run.
 * @returns The caller, or null when there is no session or no silo can be derived from
 *          the host — treat null as 401/403, never as an anonymous caller.
 */
export function _ResolveRequestPrincipal(request: Request): RequestPrincipal | null
{
  const authUser = request.session?.authUser;
  if (!authUser) return null;

  const subject = typeof authUser.sub === "string" ? authUser.sub.trim() : "";
  const email = typeof authUser.email === "string" ? authUser.email.trim().toLowerCase() : "";
  const subjectId = subject || email;
  const siloId = _ClusterTenantFromHost(_RequestHost(request)) ?? "";
  if (!subjectId || !siloId) return null;

  return { subjectId, siloId, isOrgAdmin: authUser.isOrgAdmin === true };
}
