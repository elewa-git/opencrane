import { Router, type Request, type Response } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";

import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";

import { PrismaThirdPartySourceUnitOfWork, ThirdPartySourceAuthorizationError, ThirdPartySourceNotFoundError } from "../prisma-third-party-source-authority";
import type { ThirdPartySourceAuthorizationAuthorityFactory, ThirdPartySourceRouteCaller, ThirdPartySourceRouteCallerResolver, ThirdPartySourceWriteRequest } from "./third-party-sources.types";

/** Resolves source-governance authority from the verified browser Principal. */
function _ResolveThirdPartySourceCaller(request: Request): ThirdPartySourceRouteCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal === null ? null : { siloId: principal.siloId, principalId: principal.principalId };
}

/** Returns the trusted caller or sends the fail-closed authorization response. */
function _RequireThirdPartySourceCaller(request: Request, response: Response, resolveCaller: ThirdPartySourceRouteCallerResolver): ThirdPartySourceRouteCaller | null
{
	const caller = resolveCaller(request);
	if (caller !== null)
	{
		return caller;
	}
	response.status(403).json({ error: "Authenticated Principal is required", code: "FORBIDDEN" });
	return null;
}

/** Maps central authorization denials to the public source-governance response. */
function _SendAuthorizationError(error: unknown, response: Response): boolean
{
	if (!(error instanceof ThirdPartySourceAuthorizationError))
	{
		return false;
	}
	response.status(403).json({ error: error.message, code: "FORBIDDEN" });
	return true;
}

/** Maps a silo-scoped source miss to the public not-found response. */
function _SendNotFoundError(error: unknown, response: Response): boolean
{
	if (!(error instanceof ThirdPartySourceNotFoundError))
	{
		return false;
	}
	response.status(404).json({ error: error.message, code: "THIRD_PARTY_SOURCE_NOT_FOUND" });
	return true;
}

/**
 * Serves source governance after binding every operation to the verified Principal and central authority.
 *
 * Called by: apps/opencrane/src/app/routes.ts at `/api/v1/third-party-sources`.
 */
export function thirdPartySourcesRouter(prisma: PrismaClient, resolveCaller: ThirdPartySourceRouteCallerResolver = _ResolveThirdPartySourceCaller, createAuthorization?: ThirdPartySourceAuthorizationAuthorityFactory<Prisma.TransactionClient>): Router
{
	const router = Router();
	const sources = new PrismaThirdPartySourceUnitOfWork(prisma, createAuthorization);

	router.get("/", async function _ListThirdPartySources(request, response)
	{
		const caller = _RequireThirdPartySourceCaller(request, response, resolveCaller);
		if (caller === null)
		{
			return;
		}
		try
		{
			response.json(await sources.list(caller));
		}
		catch (error)
		{
			if (!_SendAuthorizationError(error, response) && !_SendNotFoundError(error, response))
			{
				throw error;
			}
		}
	});

	router.get("/:id", async function _GetThirdPartySource(request, response)
	{
		const caller = _RequireThirdPartySourceCaller(request, response, resolveCaller);
		if (caller === null)
		{
			return;
		}
		try
		{
			const source = await sources.get(caller, String(request.params.id));
			if (source === null)
			{
				response.status(404).json({ error: "Third-party source not found", code: "THIRD_PARTY_SOURCE_NOT_FOUND" });
				return;
			}
			response.json(source);
		}
		catch (error)
		{
			if (!_SendAuthorizationError(error, response) && !_SendNotFoundError(error, response))
			{
				throw error;
			}
		}
	});

	router.post("/", async function _CreateThirdPartySource(request, response)
	{
		const caller = _RequireThirdPartySourceCaller(request, response, resolveCaller);
		if (caller === null)
		{
			return;
		}
		try
		{
			response.status(201).json(await sources.create(caller, request.body as ThirdPartySourceWriteRequest));
		}
		catch (error)
		{
			if (!_SendAuthorizationError(error, response))
			{
				throw error;
			}
		}
	});

	router.put("/:id", async function _UpdateThirdPartySource(request, response)
	{
		const caller = _RequireThirdPartySourceCaller(request, response, resolveCaller);
		if (caller === null)
		{
			return;
		}
		try
		{
			response.json(await sources.update(caller, String(request.params.id), request.body as Partial<ThirdPartySourceWriteRequest>));
		}
		catch (error)
		{
			if (!_SendAuthorizationError(error, response) && !_SendNotFoundError(error, response))
			{
				throw error;
			}
		}
	});

	router.delete("/:id", async function _DeleteThirdPartySource(request, response)
	{
		const caller = _RequireThirdPartySourceCaller(request, response, resolveCaller);
		if (caller === null)
		{
			return;
		}
		try
		{
			response.json(await sources.delete(caller, String(request.params.id)));
		}
		catch (error)
		{
			if (!_SendAuthorizationError(error, response) && !_SendNotFoundError(error, response))
			{
				throw error;
			}
		}
	});

	return router;
}
