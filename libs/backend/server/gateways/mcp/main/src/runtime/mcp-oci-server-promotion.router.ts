import { Router, type Request, type Response } from "express";

import { _RequireOrgAdmin } from "@opencrane/backend/server/infra/auth";

import { __ParseMcpOciServerPromotionCommand } from "./mcp-runtime-wire";
import type { McpOciServerPromotionResult, McpOciServerPromotionRouterDependencies } from "./mcp-runtime.types";

/** Client-visible HTTP response selected for every promotion authority outcome. */
const _PROMOTION_RESPONSE = {
	created: [201, null],
	idempotent: [200, null],
	not_found: [404, "mcp_oci_validation_not_found"],
	not_imported: [409, "mcp_oci_validation_not_imported"],
	conflict: [409, "mcp_oci_promotion_conflict"],
} as const satisfies Record<McpOciServerPromotionResult["outcome"], readonly [number, string | null]>;

/**
 * Build the administrator-only route that turns an imported OCI image into live discovery work.
 *
 * The public application already authenticates the browser session. This router additionally
 * requires the organisation-admin role and resolves the durable local Principal before it parses
 * promotion fields. The authority derives the silo from that caller and never accepts it in the
 * request body.
 *
 * Called by: the OpenCrane public route composition, mounted below `/api/v1/mcp`.
 *
 * @param dependencies - Promotion authority, authenticated caller resolver, and structured logger.
 * @returns The public OCI promotion router.
 */
export function __CreateMcpOciServerPromotionRouter(dependencies: McpOciServerPromotionRouterDependencies): Router
{
	const router = Router();
	router.post("/oci-image-validations/:id/server", _RequireOrgAdmin(), async function _Promote(request: Request, response: Response): Promise<void>
	{
		try
		{
			// 1. Bind the request to the authenticated silo and durable Principal before reading promotion input.
			const caller = await dependencies.resolveCaller(request);
			if (caller === null)
			{
				_Problem(response, 401, "mcp_promotion_authentication_required");
				return;
			}

			// 2. Accept only the bounded public fields and one non-empty validation coordinate.
			const validationId = request.params["id"];
			if (!_Coordinate(validationId))
			{
				_Problem(response, 400, "invalid_mcp_oci_promotion");
				return;
			}
			let command;
			try
			{
				command = __ParseMcpOciServerPromotionCommand(request.body);
			}
			catch
			{
				_Problem(response, 400, "invalid_mcp_oci_promotion");
				return;
			}

			// 3. Translate authority outcomes without revealing rows from another silo.
			const result = await dependencies.authority.promoteImportedValidation(caller, validationId, command);
			const [status, error] = _PROMOTION_RESPONSE[result.outcome];
			if (error === null)
			{
				response.status(status).json(result);
				return;
			}
			_Problem(response, status, error);
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "mcp.oci_server_promotion" }, "MCP OCI server promotion failed");
			_Problem(response, 503, "mcp_runtime_authority_unavailable");
		}
	});
	return router;
}

/** Accept one bounded route coordinate without control characters. */
function _Coordinate(value: unknown): value is string
{
	return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(value);
}

/** Send one short public error shape without authority details. */
function _Problem(response: Response, status: number, error: string): void
{
	response.status(status).json({ error });
}
