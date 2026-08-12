import { Router } from "express";
import type { PrismaClient } from "@prisma/client";

import type { AuditEntry } from "./audit.types.js";

/** Maximum entries per page. */
const MAX_LIMIT = 1000;

/**
 * Serves the operator-facing audit log, newest entry first.
 *
 * These are the readable entries the group and tenant routes write, not the append-only
 * authorization decisions from __AppendAuditDecision. Paging is keyset-based: the cursor is the last
 * entry's timestamp, base64url-encoded, and the handler asks for one row more than the page size so
 * it can report `hasMore` without a second COUNT query. An unreadable cursor is ignored and the first
 * page is returned; `limit` is capped at 1000.
 *
 * Called by: apps/opencrane/src/app/routes.ts, mounted at /api/v1/audit.
 * @param prisma - Silo Prisma client.
 * @returns Express router with the single GET / route.
 * @see AuditEntry
 */
export function auditRouter(prisma: PrismaClient): Router
{
  const router = Router();

  /** Query audit log entries with cursor pagination. */
  router.get("/", async function _listAuditEntries(req, res)
  {
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

    const entries = await prisma.auditEntry.findMany({
      where: {
        ...(cursorDate ? { timestamp: { lt: cursorDate } } : {}),
      },
      orderBy: { timestamp: "desc" },
      // Fetch one extra to determine hasMore without a separate COUNT query.
      take: limit + 1,
    });

    const hasMore = entries.length > limit;
    const page = entries.slice(0, limit);

    const data: AuditEntry[] = page.map(function _mapEntry(e)
    {
      return {
        timestamp: e.timestamp.toISOString(),
        action: e.action,
        resource: e.resource,
        message: e.message,
      };
    });

    const lastEntry = page.at(-1);
    const nextCursor = hasMore && lastEntry
      ? Buffer.from(lastEntry.timestamp.toISOString(), "utf8").toString("base64url")
      : undefined;

    res.json({
      data,
      pagination: { limit, hasMore, ...(nextCursor ? { nextCursor } : {}) },
    });
  });

  return router;
}
