import { Router } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";

import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";

import { PrismaAuditCatalogueUnitOfWork } from "../prisma-audit-catalogue";
import { _DecodeAuditCursor, _EncodeAuditCursor } from "./audit-cursor";
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
 * authorization decisions from PrismaAuditDecisionWriterRepository. Paging is keyset-based: the
 * opaque cursor carries the timestamp and identifier of the last examined candidate. The handler
 * asks for one row more than the page size so it can report `hasMore` without a second count query.
 * A malformed or incomplete cursor is refused; `limit` is capped at 1000.
 *
 * Called by: apps/opencrane/src/bootstrap/http/route-areas/identity-access-routes.ts, mounted at /api/v1/audit.
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
		const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 100, MAX_LIMIT));
		const encodedCursor = req.query.cursor;
		const cursor = typeof encodedCursor === "string" ? _DecodeAuditCursor(encodedCursor) : null;
		if (encodedCursor !== undefined && cursor === null)
		{
			res.status(400).json({ error: "Audit cursor is invalid", code: "INVALID_CURSOR" });
			return;
		}

		const page = await audit.list(caller, { limit, before: cursor });
		const nextCursor = page.nextCursor === null ? undefined : _EncodeAuditCursor(page.nextCursor);

		res.json({
			data: page.data,
			pagination: { limit, hasMore: page.hasMore, ...(nextCursor === undefined ? {} : { nextCursor }) },
		});
	});

	return router;
}
