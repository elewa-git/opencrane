import { Router, type Request } from "express";

import { _log } from "../log";
import { ResourceShareService } from "../resource-share-service";
import { ResourceShareKinds, ResourceShareOutcomes, type ResourceShareCallerResolver, type ResourceShareRecord } from "../resource-share.types";
import type { ResourceShareRequestBody, ResourceShareResponse } from "./resource-shares.types";

/** Resource families accepted by the public route. */
const _RESOURCE_SHARE_KINDS = new Set<string>(Object.values(ResourceShareKinds));

/** Maps the storage-neutral domain record into the public response. */
function _toResponse(record: ResourceShareRecord): ResourceShareResponse
{
	return {
		id: record.id,
		resourceType: record.resourceKind,
		resourceId: record.resourceId,
		ownerPrincipalId: record.ownerPrincipalId,
		recipientPrincipalIds: [...record.recipientPrincipalIds],
	};
}

/** Parses one untrusted resource kind into the domain vocabulary. */
function _resourceKind(value: unknown): ResourceShareKinds | null
{
	if (typeof value !== "string" || !_RESOURCE_SHARE_KINDS.has(value.trim())) return null;
	return value.trim() as ResourceShareKinds;
}

/** Reads a trimmed required string from untrusted input. */
function _requiredString(value: unknown): string | null
{
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

/**
 * Exposes direct resource sharing without owning identity, persistence, or transaction policy.
 *
 * Called by: apps/opencrane/src/app/routes.ts, mounted only at `/api/v1/resource-shares`.
 * @param service - Resource-sharing authority composed by the application root.
 * @param resolveCaller - Adapter from verified HTTP identity to one local Principal.
 * @returns Express router for create, list, and recipient revocation.
 */
export function resourceSharesRouter(service: ResourceShareService, resolveCaller: ResourceShareCallerResolver): Router
{
	const router = Router();

	/** Creates one explicit recipient after the service re-checks the caller's live grant. */
	router.post("/", async function _shareResource(req: Request, res)
	{
		const caller = await resolveCaller(req);
		if (caller === null)
		{
			res.status(401).json({ error: "Authentication required to share.", code: "UNAUTHORIZED" });
			return;
		}

		const body = (req.body ?? {}) as ResourceShareRequestBody;
		const resourceKind = _resourceKind(body.resourceType);
		const resourceId = _requiredString(body.resourceId);
		const recipientPrincipalId = _requiredString(body.recipientPrincipalId);
		if (resourceKind === null || resourceId === null || recipientPrincipalId === null)
		{
			res.status(400).json({ error: "resourceType (file|chat|dataset), resourceId, and recipientPrincipalId are required.", code: "VALIDATION_ERROR" });
			return;
		}

		const result = await service.create({ caller, resourceKind, resourceId, recipientPrincipalId, nowEpochMs: Date.now() });
		if (result.outcome === ResourceShareOutcomes.Forbidden)
		{
			res.status(403).json({ error: "You can only share a resource you currently hold.", code: "FORBIDDEN" });
			return;
		}
		if (result.outcome === ResourceShareOutcomes.NotFound)
		{
			res.status(404).json({ error: "Recipient or resource-sharing capability not found.", code: "NOT_FOUND" });
			return;
		}

		_log.info({ callerPrincipalId: caller.principalId, siloId: caller.siloId, resourceKind, resourceId, recipientPrincipalId }, "resource recipient grant reconciled");
		res.status(result.outcome === ResourceShareOutcomes.Created ? 201 : 200).json(_toResponse(result.share));
	});

	/** Lists shares owned by or granted to the authenticated local Principal. */
	router.get("/", async function _listResourceShares(req: Request, res)
	{
		const caller = await resolveCaller(req);
		if (caller === null)
		{
			res.status(401).json({ error: "Authentication required.", code: "UNAUTHORIZED" });
			return;
		}
		const shares = await service.list(caller);
		res.json(shares.map(_toResponse));
	});

	/** Revokes one explicit recipient and its exact linked grant. */
	router.delete("/:shareId/recipients/:principalId", async function _unshareResource(req: Request<{ shareId: string; principalId: string }>, res)
	{
		const caller = await resolveCaller(req);
		if (caller === null)
		{
			res.status(401).json({ error: "Authentication required.", code: "UNAUTHORIZED" });
			return;
		}
		const result = await service.revoke({ caller, shareId: req.params.shareId, recipientPrincipalId: req.params.principalId });
		if (result.outcome === ResourceShareOutcomes.NotFound)
		{
			res.status(404).json({ error: "Resource share recipient not found.", code: "NOT_FOUND" });
			return;
		}
		_log.info({ callerPrincipalId: caller.principalId, siloId: caller.siloId, shareId: req.params.shareId, recipientPrincipalId: req.params.principalId }, "resource recipient grant revoked");
		res.status(204).end();
	});

	return router;
}
