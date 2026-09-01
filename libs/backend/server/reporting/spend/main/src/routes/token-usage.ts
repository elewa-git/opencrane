import { Router } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";

import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";

import { PrismaSpendUnitOfWork } from "../prisma-spend-authority";
import type { SpendAuthorizationAuthorityFactory, SpendRouteCaller, SpendRouteCallerResolver } from "../spend.types";

/** Resolves token-usage authority from the verified browser Principal. */
function _ResolveSpendCaller(request: Parameters<SpendRouteCallerResolver>[0]): SpendRouteCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal === null ? null : { siloId: principal.siloId, principalId: principal.principalId };
}

/**
 * Build the token-usage route: recorded usage per user, newest sample first, with each user's
 * effective ceiling resolved for them — their own if they have one, otherwise the global one.
 *
 * Called by: apps/opencrane/src/app/routes.ts, mounted at `/api/v1/token-usage`.
 *
 * @param prisma - Database client used to read usage samples and both kinds of budget row.
 * @returns An Express router carrying the usage route.
 */
export function tokenUsageRouter(prisma: PrismaClient, resolveCaller: SpendRouteCallerResolver = _ResolveSpendCaller, createAuthorization?: SpendAuthorizationAuthorityFactory<Prisma.TransactionClient>): Router
{
  const router = Router();
  const spend = new PrismaSpendUnitOfWork(prisma, createAuthorization);

  /** Lists per-account token usage including resolved ceiling values. */
  router.get("/", async function _listTokenUsage(req, res)
  {
    const caller = resolveCaller(req);
    if (caller === null)
    {
      res.status(403).json({ error: "Authenticated Principal is required", code: "FORBIDDEN" });
      return;
    }
    res.json(await spend.listTokenUsage(caller));
  });

  return router;
}
