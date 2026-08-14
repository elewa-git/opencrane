import { Router, type NextFunction, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";

import { __DecideAuthorization, AuthorizationDecisionOutcomes, type AuthorizationRequest, type AuthorizationScope } from "@opencrane/models/authorization";
import { __DigestCanonicalJson, PrismaShareAuthorizationUnitOfWork, ShareAuthorizationScopeKinds, type ShareAuthorizationGrant, type ShareAuthorizationRepository } from "@opencrane/backend/server/iam/authorization";
import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";
import type { JsonValue } from "@opencrane/util";
import { _log } from "../log";
import type { CreateShareBody, SharePayloadType, ShareRecipientType, ShareScope } from "./shares.types";
// Side-effect import: loads the express-session `SessionData.authUser` augmentation.
import "@opencrane/backend/server/infra/auth";

/** The payload kinds a user may share; MCP servers only, today. */
const _PAYLOAD_TYPES: readonly SharePayloadType[] = ["mcp-server"];
/** Recipient kinds a share may target. */
const _RECIPIENT_TYPES: readonly ShareRecipientType[] = ["user", "group"];
/** Visibility scopes that the public sharing API accepts. */
const _SCOPES: readonly ShareScope[] = ["org", "department", "project", "personal"];

/** Well-known catalog for platform-owned share capabilities. */
const _SHARES_CATALOG_ID = "opencrane-core";
/** First (and only) revision used by seeded shares capabilities. */
const _SHARES_CATALOG_REVISION = 1;
/** Capability that a share grants on the recipient. */
const _SHARES_CAPABILITY_ID = "mcp-server:use";
/** Resource kind written to the AuthorizationGrant for MCP server shares. */
const _SHARES_RESOURCE_KIND = "mcp-server";
/** Priority stamped on grants created by sharing: 0, the tier reserved for one user granting another. */
const _SHARES_GRANT_PRIORITY = 0;

/** Map each public API scope into the authorization-owned sharing vocabulary. */
const _SHARE_SCOPE_BY_API: Record<ShareScope, ShareAuthorizationScopeKinds> =
{
	org: ShareAuthorizationScopeKinds.Organization,
	department: ShareAuthorizationScopeKinds.Department,
	project: ShareAuthorizationScopeKinds.Project,
	personal: ShareAuthorizationScopeKinds.Personal,
};

/** Map authorization-owned sharing scopes back into the public API vocabulary. */
const _API_SCOPE_BY_SHARE: Record<ShareAuthorizationScopeKinds, ShareScope> = {
	[ShareAuthorizationScopeKinds.Organization]: "org",
	[ShareAuthorizationScopeKinds.Department]: "department",
	[ShareAuthorizationScopeKinds.Project]: "project",
	[ShareAuthorizationScopeKinds.Personal]: "personal",
};

/** Map the API scope string to the domain AuthorizationScope used for grant evaluation. */
function _DomainScope(scope: ShareScope, organizationId: string, subjectId: string): AuthorizationScope
{
	switch (scope)
	{
		case "org": return { kind: "organization", organizationId };
		case "department": return { kind: "department", organizationId, departmentId: subjectId };
		case "project": return { kind: "project", organizationId, projectId: subjectId };
		case "personal": return { kind: "personal", organizationId, userId: subjectId };
	}
}

/** Cached catalog digest so we compute it once per process lifetime. */
let _sharesCatalogDigest: string | null = null;

/**
 * Makes sure the `opencrane-core` capability catalog revision exists before a grant references it.
 *
 * The write is an upsert on the catalog id and revision, so two first shares at once land on the same
 * catalog revision instead of one failing. The digest is cached for the process after the first call,
 * since the catalog contents are fixed in this file.
 *
 * @param repository - Authorization-owned store for capability catalogs.
 * @returns The catalog revision's digest, which every grant written below needs.
 */
async function _EnsureSharesCatalog(repository: ShareAuthorizationRepository): Promise<string>
{
	if (_sharesCatalogDigest) return _sharesCatalogDigest;

	const capabilities = [{ id: _SHARES_CAPABILITY_ID, actions: ["use"] }];
	const digest = __DigestCanonicalJson(capabilities as unknown as JsonValue);
	_sharesCatalogDigest = await repository.ensureCatalogRevision({
		catalogId: _SHARES_CATALOG_ID,
		revision: _SHARES_CATALOG_REVISION,
		digest,
		capabilities,
		createdBy: "system:shares-bootstrap",
	});
	return _sharesCatalogDigest;
}

/** Shape an AuthorizationGrant row into the API share representation. */
function _ToShare(row: ShareAuthorizationGrant)
{
	return {
		id: row.id,
		payloadType: row.resourceKind as SharePayloadType,
		payloadId: row.resourceId,
		recipientType: "user" as ShareRecipientType,
		recipientId: row.subjectId,
		scope: _API_SCOPE_BY_SHARE[row.scopeKind],
		sharedBy: row.createdBy,
		createdAt: row.createdAt.toISOString(),
	};
}

/**
 * Lets one user share an MCP server they already have access to with another user or group.
 *
 * A share is just an `Allow` AuthorizationGrant written on the recipient, which their own identity
 * then resolves like any other grant. Two rules hold it in place. First, the caller's own grants
 * must already resolve to `Allow` on that payload, so a share can never hand out more than the
 * sharer holds. Second, the sharer's id is stored on the grant, so they can list and revoke their own
 * shares and nobody else's. Re-sharing the same payload to the same recipient at the same scope
 * returns the existing grant instead of creating a second one.
 *
 * Called by: apps/opencrane/src/app/routes.ts via _CreateRateLimitedSharesRouter, mounted at
 * /api/v1/shares behind a per-IP rate limiter.
 * @param prisma - Silo Prisma client for grants and for payload/recipient existence checks.
 * @returns Express router with create, list, and revoke routes.
 */
export function sharesRouter(prisma: PrismaClient): Router
{
	const router = Router();
	const shareAuthorizationUnitOfWork = new PrismaShareAuthorizationUnitOfWork(prisma);

	/** Create a share: grant a held entitlement to another user/group (least-privilege gated). */
	router.post("/", async function _createShare(req: Request, res: Response, next: NextFunction)
	{
		try
		{
			// 1. Resolve the caller with silo scoping.
			const principal = _ResolveRequestPrincipal(req);
			if (!principal)
			{
				res.status(401).json({ error: "Authentication required to share.", code: "UNAUTHORIZED" });
				return;
			}
			const { subjectId: caller, siloId } = principal;
			const organizationId = siloId;

			// 2. Validate the body shape against the closed enum sets before any DB work.
			const body = (req.body ?? {}) as CreateShareBody;
			const payloadType = body.payloadType as SharePayloadType;
			const recipientType = body.recipientType as ShareRecipientType;
			const scope = (body.scope ?? "personal") as ShareScope;
			const payloadId = typeof body.payloadId === "string" ? body.payloadId.trim() : "";
			const recipientId = typeof body.recipientId === "string" ? body.recipientId.trim() : "";
			if (!_PAYLOAD_TYPES.includes(payloadType) || !_RECIPIENT_TYPES.includes(recipientType) || !_SCOPES.includes(scope) || !payloadId || !recipientId)
			{
				res.status(400).json({ error: "payloadType must be mcp-server; payloadId, recipientType (user|group), and recipientId are required; scope must be org|department|project|personal.", code: "VALIDATION_ERROR" });
				return;
			}

			// 3. The payload must exist (you cannot share a server that is gone).
			const payloadExists = await prisma.mcpServer.findUnique({
				where: { id: payloadId },
				select: { id: true },
			});
			if (!payloadExists)
			{
				res.status(404).json({ error: `No ${payloadType} found with id '${payloadId}'.`, code: "NOT_FOUND" });
				return;
			}

			// 4. A group recipient must be a real group; a user recipient is an opaque IdP subject
			//    (users live in Zitadel, not the local DB), so it is accepted as-is.
			if (recipientType === "group")
			{
				const group = await prisma.group.findUnique({ where: { id: recipientId }, select: { id: true } });
				if (!group)
				{
					res.status(404).json({ error: `No group found with id '${recipientId}'.`, code: "NOT_FOUND" });
					return;
				}
			}

			await shareAuthorizationUnitOfWork.execute(async function _createWithAuthorization(transaction): Promise<void>
			{
				const { grantRepository, shareRepository } = transaction;
				// 5. Ensure the well-known shares catalog revision exists for FK integrity.
				const catalogDigest = await _EnsureSharesCatalog(shareRepository);

			// 6. LEAST-PRIVILEGE GATE: the caller may only share what they themselves hold. Evaluate
			//    the caller's own grants and require an Allow on this payload -- a Deny or an absent
			//    grant fails closed (403), so sharing can never escalate privilege.
				const callerGrants = await grantRepository.listSubjectGrants(siloId, caller);
				const callerRequest: AuthorizationRequest =
				{
				siloId,
				subjectId: caller,
				scope: _DomainScope(scope, organizationId, caller),
				capability: { catalog: { catalogId: _SHARES_CATALOG_ID, revision: _SHARES_CATALOG_REVISION, digest: catalogDigest as `sha256:${string}` }, capabilityId: _SHARES_CAPABILITY_ID },
				resource: { kind: _SHARES_RESOURCE_KIND, id: payloadId },
				nowEpochMs: Date.now(),
				};
				const decision = __DecideAuthorization(callerRequest, callerGrants);
				if (decision.outcome !== AuthorizationDecisionOutcomes.Allow)
				{
				_log.warn({ caller, siloId, payloadType, payloadId, recipientType, recipientId, reason: decision.reason }, "share denied: caller does not hold an Allow on the payload (least-privilege gate)");
				res.status(403).json({ error: "You can only share an entitlement you currently hold.", code: "FORBIDDEN" });
					return;
				}

			// 7. Idempotent on the durable AuthorizationGrant authority key: re-sharing the same payload
			//    to the same recipient at the same scope returns the one existing entitlement, regardless
			//    of which already-authorized caller made the duplicate request.
				const persisted = await shareRepository.createOrFindExactShare({
				siloId,
				subjectId: recipientId,
				scopeKind: _SHARE_SCOPE_BY_API[scope],
				organizationId,
				catalogId: _SHARES_CATALOG_ID,
				catalogRevision: _SHARES_CATALOG_REVISION,
				catalogDigest,
				capabilityId: _SHARES_CAPABILITY_ID,
				resourceKind: _SHARES_RESOURCE_KIND,
				resourceId: payloadId,
				priority: _SHARES_GRANT_PRIORITY,
				createdBy: caller,
				});
				if (!persisted.created)
				{
				res.status(200).json(_ToShare(persisted.share));
					return;
				}

			// 8. A successful insert grants the recipient only the exact capability that policy allowed.
				_log.info({ caller, siloId, payloadType, payloadId, recipientType, recipientId, grantId: persisted.share.id }, "share created (inherited by the recipient's tenant on its next contract poll)");
				res.status(201).json(_ToShare(persisted.share));
			});
		}
		catch (err)
		{
			next(err);
		}
	});

	/** List the shares the caller has created (never another user's). */
	router.get("/", async function _listShares(req: Request, res: Response, next: NextFunction)
	{
		try
		{
			const principal = _ResolveRequestPrincipal(req);
			if (!principal)
			{
				res.status(401).json({ error: "Authentication required.", code: "UNAUTHORIZED" });
				return;
			}
			const rows = await shareAuthorizationUnitOfWork.execute(async function _listWithAuthorization(transaction)
			{
				return transaction.shareRepository.listActiveShares(principal.siloId, principal.subjectId, _SHARES_CATALOG_ID, _SHARES_CAPABILITY_ID);
			});
			res.json(rows.map(_ToShare));
		}
		catch (err)
		{
			next(err);
		}
	});

	/** Revoke a share -- only one the caller created (a sharer holds no power over others' grants). */
	router.delete("/:id", async function _revokeShare(req: Request<{ id: string }>, res: Response, next: NextFunction)
	{
		try
		{
			const principal = _ResolveRequestPrincipal(req);
			if (!principal)
			{
				res.status(401).json({ error: "Authentication required.", code: "UNAUTHORIZED" });
				return;
			}
			const revoked = await shareAuthorizationUnitOfWork.execute(async function _revokeWithAuthorization(transaction)
			{
				return transaction.shareRepository.revokeOwnedShare(principal.siloId, principal.subjectId, req.params.id);
			});
			if (!revoked)
			{
				res.status(404).json({ error: "Share not found.", code: "NOT_FOUND" });
				return;
			}
			_log.info({ caller: principal.subjectId, siloId: principal.siloId, grantId: req.params.id }, "share revoked");
			res.json({ id: req.params.id, status: "revoked" });
		}
		catch (err)
		{
			next(err);
		}
	});

	return router;
}
