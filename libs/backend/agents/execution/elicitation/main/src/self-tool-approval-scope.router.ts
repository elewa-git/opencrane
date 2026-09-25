import { PrismaClient } from "@prisma/client";
import { Router, type Request, type Response } from "express";
import type { Logger } from "pino";

import { PrismaToolApprovalScopeUnitOfWork, type ToolApprovalScopeCaller } from "@opencrane/backend/server/iam/authorization";
import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";

/** Create the requester-owned standing approval catalogue and revocation surface. */
export function _CreateSelfToolApprovalScopeRouter(prisma: PrismaClient, logger: Logger): Router
{
	const router = Router();
	const authority = new PrismaToolApprovalScopeUnitOfWork(prisma);
	router.get("/", async function _List(request: Request, response: Response)
	{
		const caller = _Caller(request);
		const cursor = _Cursor(request.query["cursor"]);
		if (caller === null)
		{ _Respond(response, 401, "tool_approval_scope_authentication_required"); return; }
		if (cursor === undefined || Object.keys(request.query).some(key => key !== "cursor"))
		{ _Respond(response, 400, "invalid_tool_approval_scope_cursor"); return; }
		try
		{
			response.status(200).json(await authority.list(caller, cursor, new Date()));
		}
		catch (err)
		{
			logger.error({ err, operation: "tool_approval_scope.list", siloId: caller.siloId }, "Standing approval catalogue read failed");
			_Respond(response, 503, "tool_approval_scope_read_unavailable");
		}
	});
	router.post("/:scopeId/revocation", async function _Revoke(request: Request, response: Response)
	{
		const caller = _Caller(request);
		const scopeId = request.params["scopeId"];
		const idempotencyKey = _IdempotencyKey(request.body);
		if (caller === null)
		{ _Respond(response, 401, "tool_approval_scope_authentication_required"); return; }
		if (typeof scopeId !== "string" || scopeId.trim().length === 0 || idempotencyKey === null)
		{ _Respond(response, 400, "invalid_tool_approval_scope_revocation"); return; }
		try
		{
			const result = await authority.revoke(caller, scopeId, idempotencyKey, new Date());
			if (result.outcome === "revoked")
			{ response.status(200).json({ scope: result.scope, idempotent: result.idempotent }); return; }
			if (result.outcome === "not_found")
			{ _Respond(response, 404, "tool_approval_scope_not_found"); return; }
			if (result.outcome === "forbidden")
			{ _Respond(response, 403, "tool_approval_scope_revocation_forbidden"); return; }
			_Respond(response, 409, "tool_approval_scope_revocation_conflict");
		}
		catch (err)
		{
			logger.error({ err, operation: "tool_approval_scope.revoke", siloId: caller.siloId, scopeId }, "Standing approval revocation failed");
			_Respond(response, 503, "tool_approval_scope_revocation_unavailable");
		}
	});
	return router;
}

/** Resolve trusted browser-session coordinates without accepting identity from the request body. */
function _Caller(request: Request): ToolApprovalScopeCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal === null ? null : { siloId: principal.siloId, subjectId: principal.externalSubject };
}

/** Parse an optional bounded opaque continuation coordinate. */
function _Cursor(value: unknown): string | null | undefined
{
	if (value === undefined)
		return null;
	return typeof value === "string" && value.trim().length > 0 && value.length <= 500 ? value : undefined;
}

/** Parse the exact revocation body. */
function _IdempotencyKey(value: unknown): string | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return null;
	const record = value as Record<string, unknown>;
	const key = record["idempotencyKey"];
	return Object.keys(record).length === 1 && typeof key === "string" && key.trim().length > 0 && key.length <= 200 ? key : null;
}

/** Write one bounded JSON error. */
function _Respond(response: Response, status: number, error: string): void
{
	response.status(status).json({ error });
}
