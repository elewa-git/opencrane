import { Router, type Request, type Response } from "express";

import { McpConnectionConflictError } from "../connections/mcp-connection-admission";
import { McpConnectionOwnerKinds, type McpConnectionAuthority } from "../connections/mcp-connection.types";
import { ___McpConnectionCommandSchema, ___McpConnectionIdentifierSchema, ___McpConnectionRevocationSchema } from "../connections/mcp-connection.validator";
import { _RequireMcpCaller } from "./mcp-caller";
import type { McpCallerResolver } from "./mcp-caller.types";

/** Authenticated write-only routes for personal and managed-service MCP connections. */
export function mcpConnectionRouter(authority: Pick<McpConnectionAuthority, "connect" | "revoke">, resolveCaller: McpCallerResolver): Router
{
	const router = Router();

	router.put("/installed/:serverId/connection", async function _ConnectPersonal(req: Request<{ serverId: string }>, res: Response)
	{
		const caller = await resolveCaller(req);
		if (!_RequireMcpCaller(res, caller))
			return;
		if (!___McpConnectionIdentifierSchema.safeParse(req.params.serverId).success)
		{
			_SendInvalid(res);
			return;
		}
		const parsed = ___McpConnectionCommandSchema.safeParse(req.body);
		if (!parsed.success)
		{
			_SendInvalid(res);
			return;
		}
		await _Connect(res, authority, { actor: { siloId: caller.siloId, actorPrincipalId: caller.principalId, ownerKind: McpConnectionOwnerKinds.Personal }, serverId: req.params.serverId, command: parsed.data });
	});

	router.delete("/installed/:serverId/connection", async function _RevokePersonal(req: Request<{ serverId: string }>, res: Response)
	{
		const caller = await resolveCaller(req);
		if (!_RequireMcpCaller(res, caller))
			return;
		if (!___McpConnectionIdentifierSchema.safeParse(req.params.serverId).success)
		{
			_SendInvalid(res);
			return;
		}
		const parsed = ___McpConnectionRevocationSchema.safeParse(req.query);
		if (!parsed.success)
		{
			_SendInvalid(res);
			return;
		}
		await _Revoke(res, authority, { actor: { siloId: caller.siloId, actorPrincipalId: caller.principalId, ownerKind: McpConnectionOwnerKinds.Personal }, serverId: req.params.serverId, idempotencyKey: parsed.data.commandId, expectedGeneration: parsed.data.expectedGeneration });
	});

	router.put("/servers/:serverId/service-connections/:agentServiceId", async function _ConnectService(req: Request<{ serverId: string; agentServiceId: string }>, res: Response)
	{
		const caller = await resolveCaller(req);
		if (!_RequireMcpCaller(res, caller))
			return;
		if (!___McpConnectionIdentifierSchema.safeParse(req.params.serverId).success || !___McpConnectionIdentifierSchema.safeParse(req.params.agentServiceId).success)
		{
			_SendInvalid(res);
			return;
		}
		const parsed = ___McpConnectionCommandSchema.safeParse(req.body);
		if (!parsed.success)
		{
			_SendInvalid(res);
			return;
		}
		await _Connect(res, authority, { actor: { siloId: caller.siloId, actorPrincipalId: caller.principalId, ownerKind: McpConnectionOwnerKinds.ManagedService, agentServiceId: req.params.agentServiceId }, serverId: req.params.serverId, command: parsed.data });
	});

	router.delete("/servers/:serverId/service-connections/:agentServiceId", async function _RevokeService(req: Request<{ serverId: string; agentServiceId: string }>, res: Response)
	{
		const caller = await resolveCaller(req);
		if (!_RequireMcpCaller(res, caller))
			return;
		if (!___McpConnectionIdentifierSchema.safeParse(req.params.serverId).success || !___McpConnectionIdentifierSchema.safeParse(req.params.agentServiceId).success)
		{
			_SendInvalid(res);
			return;
		}
		const parsed = ___McpConnectionRevocationSchema.safeParse(req.query);
		if (!parsed.success)
		{
			_SendInvalid(res);
			return;
		}
		await _Revoke(res, authority, { actor: { siloId: caller.siloId, actorPrincipalId: caller.principalId, ownerKind: McpConnectionOwnerKinds.ManagedService, agentServiceId: req.params.agentServiceId }, serverId: req.params.serverId, idempotencyKey: parsed.data.commandId, expectedGeneration: parsed.data.expectedGeneration });
	});

	return router;
}

async function _Connect(response: Response, authority: Pick<McpConnectionAuthority, "connect">, command: Parameters<McpConnectionAuthority["connect"]>[0]): Promise<void>
{
	try
	{
		const projection = await authority.connect(command);
		if (!projection)
		{
			_SendUnavailable(response);
			return;
		}
		response.status(202).json(projection);
	}
	catch (error)
	{
		if (!_SendConflict(response, error))
			throw error;
	}
}

async function _Revoke(response: Response, authority: Pick<McpConnectionAuthority, "revoke">, command: Parameters<McpConnectionAuthority["revoke"]>[0]): Promise<void>
{
	try
	{
		const projection = await authority.revoke(command);
		if (!projection)
		{
			_SendUnavailable(response);
			return;
		}
		response.status(202).json(projection);
	}
	catch (error)
	{
		if (!_SendConflict(response, error))
			throw error;
	}
}

function _SendInvalid(response: Response): void
{
	response.status(400).json({ error: "MCP connection command is invalid.", code: "VALIDATION_ERROR" });
}

function _SendUnavailable(response: Response): void
{
	response.status(404).json({ error: "MCP connection is unavailable.", code: "MCP_CONNECTION_UNAVAILABLE" });
}

function _SendConflict(response: Response, error: unknown): boolean
{
	if (!(error instanceof McpConnectionConflictError) && (!(error instanceof Error) || error.name !== "McpConnectionConflictError"))
		return false;
	response.status(409).json({ error: "MCP connection command conflicts with the saved generation.", code: "MCP_CONNECTION_CONFLICT" });
	return true;
}
