import { Router } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";

import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";

import { PrismaAuditCatalogueUnitOfWork } from "../prisma-audit-catalogue";
import type { AuditAuthorizationAuthorityFactory, AuditRouteCaller, AuditRouteCallerResolver } from "./audit.types";

/** Maximum entries per page. */
const MAX_LIMIT = 1000;

/** Resolves audit-log authority from the verified browser Principal. */
function _ResolveAuditCaller(request: Parameters<AuditRouteCallerResolver>[0]): AuditRouteCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal === null ? null : { siloId: principal.siloId, principalId: principal.principalId };
}

/**
 * Serves the operator-facing audit log, newest entry first.
 *
 * These are the readable entries the group and tenant routes write, not the append-only
 * authorization decisions from PrismaAuditDecisionWriterRepository. Paging is keyset-based: the cursor is the last
 * entry's timestamp, base64url-encoded, and the handler asks for one row more than the page size so
 * it can report `hasMore` without a second COUNT query. An unreadable cursor is ignored and the first
 * page is returned; `limit` is capped at 1000.
 *
 * Called by: apps/opencrane/src/app/routes.ts, mounted at /api/v1/audit.
 * @param prisma - Silo Prisma client.
 * @returns Express router with the single GET / route.
 * @see AuditEntry
 */
export function auditRouter(prisma: PrismaClient, createAuthorization: AuditAuthorizationAuthorityFactory<Prisma.TransactionClient>, resolveCaller: AuditRouteCallerResolver = _ResolveAuditCaller): Router
{
  const router = Router();
  const audit = new PrismaAuditCatalogueUnitOfWork(prisma, createAuthorization);

  /** Query audit log entries with cursor pagination. */
  router.get("/", async function _listAuditEntries(req, res)
  {
    const caller = resolveCaller(req);
    if (caller === null)
    {
      res.status(403).json({ error: "Authenticated Principal is required", code: "FORBIDDEN" });
      return;
    }
    const rawLimit = Number(req.query.limit ?? "100");
    const limit = Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 100, MAX_LIMIT);
    const cursor = req.query.cursor as string | undefined;

    // Decode the cursor (ISO timestamp) if provided.
    let cursorDate: Date | undefined;
    if (cursor)
    {
      const decoded = Buffer.from(cursor, "base64url").toString("utf8");
      const ts = Date.parse(decoded);
      if (!Number.isNaN(ts))
      {
        cursorDate = new Date(ts);
      }
    }

    const page = await audit.list(caller, { limit, before: cursorDate ?? null });
    const nextCursor = page.nextCursorAt === null ? undefined : Buffer.from(page.nextCursorAt.toISOString(), "utf8").toString("base64url");

    res.json({
      data: page.data,
      pagination: { limit, hasMore: page.hasMore, ...(nextCursor ? { nextCursor } : {}) },
    });
  });

  return router;
}
