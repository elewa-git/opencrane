import { Router, type Request, type Response } from "express";

import { __ParseMcpCompanionClaimRequest, __ParseMcpCompanionCompletionRequest, __ParseMcpCompanionFailureRequest } from "@opencrane/backend/agents/runtime/mcp-executor/companion";
import type { RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";

import { McpRuntimeCompanionClaimOutcomes, type McpRuntimeCompanionRouterDependencies } from "./mcp-runtime.types";

/**
 * Build the three Pod-bound routes used by the one-shot MCP companion.
 *
 * Each handler TokenReviews the projected bearer token before parsing the body. The body may carry
 * the downward-API Pod UID for wire consistency, but it cannot establish identity: the router
 * requires it to equal the Pod UID Kubernetes returned and passes that reviewed identity to the
 * durable authority.
 *
 * Called by: the OpenCrane internal route composition, mounted at `/api/internal/mcp-executor`.
 *
 * @param dependencies - Runtime authority, companion TokenReview adapter, and structured logger.
 * @returns The internal MCP companion router.
 */
export function __CreateMcpRuntimeCompanionRouter(dependencies: McpRuntimeCompanionRouterDependencies): Router
{
	const router = Router();

	router.post("/claim", async function _Claim(request: Request, response: Response): Promise<void>
	{
		try
		{
			const identity = await _Identity(request, dependencies);
			if (identity === null)
			{
				_Problem(response, 401, "mcp_companion_identity_denied");
				return;
			}
			let command;
			try
			{
				command = __ParseMcpCompanionClaimRequest(request.body);
			}
			catch
			{
				_Problem(response, 400, "invalid_mcp_companion_claim");
				return;
			}
			if (command.podUid !== identity.podUid)
			{
				_Problem(response, 401, "mcp_companion_identity_denied");
				return;
			}
			const claim = await dependencies.authority.claimCompanion(identity, command.executionReference);
			if (claim === null)
			{
				response.status(204).end();
				return;
			}
			if (claim === McpRuntimeCompanionClaimOutcomes.Terminal)
			{
				response.status(410).end();
				return;
			}
			response.status(200).json(claim);
		}
		catch (err)
		{
			_Failure(response, dependencies, err, "mcp_companion.claim", "MCP companion claim failed");
		}
	});

	router.post("/complete", async function _Complete(request: Request, response: Response): Promise<void>
	{
		try
		{
			const identity = await _Identity(request, dependencies);
			if (identity === null)
			{
				_Problem(response, 401, "mcp_companion_identity_denied");
				return;
			}
			let command;
			try
			{
				command = __ParseMcpCompanionCompletionRequest(request.body);
			}
			catch
			{
				_Problem(response, 400, "invalid_mcp_companion_completion");
				return;
			}
			if (command.podUid !== identity.podUid)
			{
				_Problem(response, 401, "mcp_companion_identity_denied");
				return;
			}
			const outcome = await dependencies.authority.completeCompanion(identity, command);
			_Terminal(response, outcome === "conflict");
		}
		catch (err)
		{
			_Failure(response, dependencies, err, "mcp_companion.complete", "MCP companion completion failed");
		}
	});

	router.post("/fail", async function _Fail(request: Request, response: Response): Promise<void>
	{
		try
		{
			const identity = await _Identity(request, dependencies);
			if (identity === null)
			{
				_Problem(response, 401, "mcp_companion_identity_denied");
				return;
			}
			let command;
			try
			{
				command = __ParseMcpCompanionFailureRequest(request.body);
			}
			catch
			{
				_Problem(response, 400, "invalid_mcp_companion_failure");
				return;
			}
			if (command.podUid !== identity.podUid)
			{
				_Problem(response, 401, "mcp_companion_identity_denied");
				return;
			}
			const outcome = await dependencies.authority.failCompanion(identity, command);
			_Terminal(response, outcome === "conflict");
		}
		catch (err)
		{
			_Failure(response, dependencies, err, "mcp_companion.fail", "MCP companion failure report failed");
		}
	});

	return router;
}

/** Review a single bearer token into its Kubernetes-bound companion identity. */
async function _Identity(request: Request, dependencies: McpRuntimeCompanionRouterDependencies): Promise<RuntimeWorkloadIdentity | null>
{
	const token = _Bearer(request.header("authorization"));
	if (token === null)
		return null;
	return dependencies.tokenReviewer.__Review(token);
}

/** Read one unambiguous bearer credential. */
function _Bearer(value: string | undefined): string | null
{
	return /^Bearer ([^\s,]+)$/u.exec(value ?? "")?.[1] ?? null;
}

/** Return the terminal status expected by the one-shot companion client. */
function _Terminal(response: Response, conflict: boolean): void
{
	if (conflict)
	{
		_Problem(response, 409, "stale_or_conflicting_mcp_companion_report");
		return;
	}
	response.status(204).end();
}

/** Log an internal outage without request credentials or MCP content. */
function _Failure(response: Response, dependencies: McpRuntimeCompanionRouterDependencies, err: unknown, operation: string, message: string): void
{
	dependencies.logger.error({ err, operation }, message);
	_Problem(response, 503, "mcp_runtime_authority_unavailable");
}

/** Send one short internal error response. */
function _Problem(response: Response, status: number, error: string): void
{
	response.status(status).json({ error });
}
