import { Router, type NextFunction, type Request, type Response } from "express";
import type { AuthorizationScopeKind, PrismaClient } from "@prisma/client";

import { __DecideAuthorization } from "@opencrane/models/authorization";
import type { AuthorizationRequest, AuthorizationScope } from "@opencrane/models/authorization";
import { __DigestCanonicalJson, PrismaAuthorizationGrantRepository } from "@opencrane/backend/server/iam/authorization";
import { _ResolveRequestPrincipal } from "@opencrane/server/_infra/auth";
import type { JsonValue } from "@opencrane/util";
import { _log } from "../log.js";
import type { CreateShareBody, SharePayloadType, ShareRecipientType, ShareScope } from "./shares.types.js";

/** Payload families a user may share (the entitlement surfaces the runtime contract carries). */
const _PAYLOAD_TYPES: readonly SharePayloadType[] = ["mcp-server"];
/** Recipient kinds a share may target. */
const _RECIPIENT_TYPES: readonly ShareRecipientType[] = ["user", "group"];
/** Visibility scopes a share may carry (mirrors AuthorizationScopeKind; defaults to personal). */
const _SCOPES: readonly ShareScope[] = ["org", "department", "project", "personal"];

/** Well-known catalog for platform-owned share capabilities. */
const _SHARES_CATALOG_ID = "opencrane-core";
/** First (and only) revision used by seeded shares capabilities. */
const _SHARES_CATALOG_REVISION = 1;
/** Capability that a share grants on the recipient. */
const _SHARES_CAPABILITY_ID = "mcp-server:use";
/** Resource kind written to the AuthorizationGrant for MCP server shares. */
const _SHARES_RESOURCE_KIND = "mcp-server";
/** Priority for share-originated grants (user-to-user delegation, lowest tier). */
const _SHARES_GRANT_PRIORITY = 0;

/** Map the API scope string to the Prisma AuthorizationScopeKind enum. */
const _PRISMA_SCOPE_BY_API: Record<ShareScope, AuthorizationScopeKind> =
{
	org: "Organization" as AuthorizationScopeKind,
	department: "Department" as AuthorizationScopeKind,
	project: "Project" as AuthorizationScopeKind,
	personal: "Personal" as AuthorizationScopeKind,
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
 * Ensures the well-known `opencrane-core` CapabilityCatalogRevision exists (seeded).
 * Uses findFirst+create rather than upsert because the unique key is a composite triple.
 *
 * @param prisma - Prisma client for catalog reads/writes.
 * @returns The deterministic digest of the seeded catalog revision.
 */
async function _EnsureSharesCatalog(prisma: PrismaClient): Promise<string>
{
	if (_sharesCatalogDigest) return _sharesCatalogDigest;

	const capabilities = [{ id: _SHARES_CAPABILITY_ID, actions: ["use"] }];
	const digest = __DigestCanonicalJson(capabilities as unknown as JsonValue);

	const existing = await prisma.capabilityCatalogRevision.findFirst({
		where: { catalogId: _SHARES_CATALOG_ID, revision: _SHARES_CATALOG_REVISION },
		select: { digest: true },
	});

	if (existing)
	{
		_sharesCatalogDigest = existing.digest;
		return _sharesCatalogDigest;
	}

	const created = await prisma.capabilityCatalogRevision.create({
		data: {
			catalogId: _SHARES_CATALOG_ID,
			revision: _SHARES_CATALOG_REVISION,
			digest,
			capabilities,
			createdBy: "system:shares-bootstrap",
		},
	});
	_sharesCatalogDigest = created.digest;
	return _sharesCatalogDigest;
}

/** Shape an AuthorizationGrant row into the API share representation. */
function _ToShare(row: { id: string; resourceKind: string; resourceId: string; subjectId: string; scopeKind: string; createdBy: string; createdAt: Date })
{
	return {
		id: row.id,
		payloadType: row.resourceKind as SharePayloadType,
		payloadId: row.resourceId,
		recipientType: "user" as ShareRecipientType,
		recipientId: row.subjectId,
		scope: _ApiScopeFromPrisma(row.scopeKind),
		sharedBy: row.createdBy,
		createdAt: row.createdAt.toISOString(),
	};
}

/** Reverse-map a Prisma AuthorizationScopeKind to the API scope string. */
function _ApiScopeFromPrisma(kind: string): ShareScope
{
	switch (kind)
	{
		case "Organization": return "org";
		case "Department": return "department";
		case "Project": return "project";
		case "Personal": return "personal";
		default: return "personal";
	}
}

/**
 * Inter-user sharing router (S4). A user shares an entitlement they themselves hold with
 * another user or group; the share is an `Allow` AuthorizationGrant on the recipient, which
 * the recipient's user identity then resolves through deterministic grant evaluation. Sharing
 * is **least-privilege bounded**: the caller may only share a payload for which their own
 * grants resolve to `Allow` -- there is no privilege escalation. The sharer is recorded
 * (`AuthorizationGrant.createdBy`) so they can list and revoke only their own shares.
 *
 * @param prisma - Prisma client for authorization grant + payload/recipient lookups.
 * @returns Configured Express router.
 */
export function sharesRouter(prisma: PrismaClient): Router
{
	const router = Router();
	const grantRepository = new PrismaAuthorizationGrantRepository(prisma);

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

			// 5. Ensure the well-known shares catalog revision exists for FK integrity.
			const catalogDigest = await _EnsureSharesCatalog(prisma);

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
			if (decision.outcome !== "allow")
			{
				_log.warn({ caller, siloId, payloadType, payloadId, recipientType, recipientId, reason: decision.reason }, "share denied: caller does not hold an Allow on the payload (least-privilege gate)");
				res.status(403).json({ error: "You can only share an entitlement you currently hold.", code: "FORBIDDEN" });
				return;
			}

			// 7. Idempotent on the AuthorizationGrant unique key: re-sharing the same payload to the
			//    same recipient at the same scope returns the existing grant.
			const existing = await prisma.authorizationGrant.findFirst({
				where: {
					siloId,
					subjectId: recipientId,
					scopeKind: _PRISMA_SCOPE_BY_API[scope],
					organizationId,
					catalogId: _SHARES_CATALOG_ID,
					catalogRevision: _SHARES_CATALOG_REVISION,
					capabilityId: _SHARES_CAPABILITY_ID,
					resourceKind: _SHARES_RESOURCE_KIND,
					resourceId: payloadId,
					effect: "Allow",
					createdBy: caller,
					revokedAt: null,
				},
			});
			if (existing)
			{
				res.status(200).json(_ToShare(existing));
				return;
			}

			// 8. Write the share as an Allow AuthorizationGrant on the recipient.
			const created = await prisma.authorizationGrant.create({
				data: {
					siloId,
					subjectId: recipientId,
					scopeKind: _PRISMA_SCOPE_BY_API[scope],
					organizationId,
					scopeResourceId: null,
					catalogId: _SHARES_CATALOG_ID,
					catalogRevision: _SHARES_CATALOG_REVISION,
					catalogDigest: catalogDigest,
					capabilityId: _SHARES_CAPABILITY_ID,
					resourceKind: _SHARES_RESOURCE_KIND,
					resourceId: payloadId,
					effect: "Allow",
					priority: _SHARES_GRANT_PRIORITY,
					createdBy: caller,
				},
			});
			_log.info({ caller, siloId, payloadType, payloadId, recipientType, recipientId, grantId: created.id }, "share created (inherited by the recipient's tenant on its next contract poll)");
			res.status(201).json(_ToShare(created));
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
			const rows = await prisma.authorizationGrant.findMany({
				where: {
					siloId: principal.siloId,
					createdBy: principal.subjectId,
					capabilityId: _SHARES_CAPABILITY_ID,
					catalogId: _SHARES_CATALOG_ID,
					revokedAt: null,
				},
				orderBy: { createdAt: "desc" },
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
			const grant = await prisma.authorizationGrant.findUnique({
				where: { id: req.params.id },
				select: { id: true, createdBy: true, siloId: true },
			});
			if (!grant || grant.createdBy !== principal.subjectId || grant.siloId !== principal.siloId)
			{
				res.status(404).json({ error: "Share not found.", code: "NOT_FOUND" });
				return;
			}
			await prisma.authorizationGrant.delete({ where: { id: req.params.id } });
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
