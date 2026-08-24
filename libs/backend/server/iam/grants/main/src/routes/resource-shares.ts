import { Router, type Request } from "express";

import { _log } from "../log";
import { ResourceShareService } from "../resource-share-service";
import { ResourceShareOutcomes, type ResourceShareCallerResolver, type ResourceShareRecord } from "../resource-share.types";
import type { ResourceShareResponse } from "./resource-shares.types";

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

/**
 * Exposes direct resource sharing without owning identity, persistence, or transaction policy.
 *
 * Called by: apps/opencrane/src/app/routes.ts, mounted only at `/api/v1/resource-shares`.
 * @param service - Resource-sharing authority composed by the application root.
 * @param resolveCaller - Adapter from verified HTTP identity to one local Principal.
 * @returns Express router for listing migrated shares and recipient revocation.
 */
export function resourceSharesRouter(service: ResourceShareService, resolveCaller: ResourceShareCallerResolver): Router
{
	const router = Router();

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
