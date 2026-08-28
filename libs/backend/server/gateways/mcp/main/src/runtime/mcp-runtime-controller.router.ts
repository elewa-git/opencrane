import { Router, type Request, type Response } from "express";

import { AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE, AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME } from "@opencrane/contracts";
import type { ReviewedFixedServiceAccountIdentity } from "@opencrane/backend/server/infra/workload-identity";

import { __ParseMcpRuntimeAssignment, __ParseMcpRuntimeCleanupCommand, __ParseMcpRuntimePodRegistrationCommand, __ParseMcpRuntimeReleaseCommand } from "./mcp-runtime-wire";
import type { McpRuntimeControllerRouterDependencies } from "./mcp-runtime.types";

/**
 * Build the seven controller-only routes for MCP executor assignment, release, and cleanup.
 *
 * This router is mounted on the private listener and is not behind browser authentication. Every
 * handler therefore reviews the projected token before parsing request data, then rechecks all
 * returned fields against the one deployment-fixed agent-controller identity.
 *
 * Called by: the OpenCrane internal route composition, mounted below `/api/internal/agent-controller`.
 *
 * @param dependencies - Runtime authority, fixed TokenReview adapter, namespace, and logger.
 * @returns The internal MCP controller router.
 */
export function __CreateMcpRuntimeControllerRouter(dependencies: McpRuntimeControllerRouterDependencies): Router
{
	const router = Router();

	router.post("/mcp-executor\\:claim", async function _Claim(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _Controller(request, dependencies))
			{
				_Problem(response, 401, "controller_identity_denied");
				return;
			}
			if (!_EmptyCommand(request.body))
			{
				_Problem(response, 400, "invalid_mcp_runtime_claim");
				return;
			}
			const claim = await dependencies.authority.claimNextController();
			if (claim === null)
			{
				response.status(204).end();
				return;
			}
			response.status(200).json(claim);
		}
		catch (err)
		{
			_Failure(response, dependencies, err, "agent_controller.mcp_executor_claim", "Agent-controller MCP executor claim failed");
		}
	});

	router.put("/mcp-executor/:claimId/assignment", async function _Assignment(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _Controller(request, dependencies))
			{
				_Problem(response, 401, "controller_identity_denied");
				return;
			}
			const claimId = request.params["claimId"];
			if (!_Coordinate(claimId))
			{
				_Problem(response, 400, "invalid_mcp_runtime_assignment");
				return;
			}
			let binding;
			try
			{
				binding = __ParseMcpRuntimeAssignment(claimId, request.body);
			}
			catch
			{
				_Problem(response, 400, "invalid_mcp_runtime_assignment");
				return;
			}
			const outcome = await dependencies.authority.commitAssignment(binding);
			_WriteOutcome(response, outcome);
		}
		catch (err)
		{
			_Failure(response, dependencies, err, "agent_controller.mcp_executor_assignment", "Agent-controller MCP executor assignment failed");
		}
	});

	router.post("/mcp-executor\\:release-claim", async function _ReleaseClaim(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _Controller(request, dependencies))
			{
				_Problem(response, 401, "controller_identity_denied");
				return;
			}
			if (!_EmptyCommand(request.body))
			{
				_Problem(response, 400, "invalid_mcp_runtime_release_claim");
				return;
			}
			const claim = await dependencies.authority.claimNextRelease();
			if (claim === null)
			{
				response.status(204).end();
				return;
			}
			response.status(200).json(claim);
		}
		catch (err)
		{
			_Failure(response, dependencies, err, "agent_controller.mcp_executor_release_claim", "Agent-controller MCP executor release claim failed");
		}
	});

	router.put("/mcp-executor/:claimId/release", async function _Release(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _Controller(request, dependencies))
			{
				_Problem(response, 401, "controller_identity_denied");
				return;
			}
			const claimId = request.params["claimId"];
			if (!_Coordinate(claimId))
			{
				_Problem(response, 400, "invalid_mcp_runtime_release");
				return;
			}
			let command;
			try
			{
				command = __ParseMcpRuntimeReleaseCommand(request.body);
			}
			catch
			{
				_Problem(response, 400, "invalid_mcp_runtime_release");
				return;
			}
			const outcome = await dependencies.authority.commitRelease(claimId, command);
			_WriteOutcome(response, outcome);
		}
		catch (err)
		{
			_Failure(response, dependencies, err, "agent_controller.mcp_executor_release", "Agent-controller MCP executor release failed");
		}
	});

	router.post("/mcp-executor\\:cleanup-claim", async function _CleanupClaim(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _Controller(request, dependencies))
			{
				_Problem(response, 401, "controller_identity_denied");
				return;
			}
			if (!_EmptyCommand(request.body))
			{
				_Problem(response, 400, "invalid_mcp_runtime_cleanup_claim");
				return;
			}
			const claim = await dependencies.authority.claimNextCleanup();
			if (claim === null)
			{
				response.status(204).end();
				return;
			}
			response.status(200).json(claim);
		}
		catch (err)
		{
			_Failure(response, dependencies, err, "agent_controller.mcp_executor_cleanup_claim", "Agent-controller MCP executor cleanup claim failed");
		}
	});

	router.put("/mcp-executor/:claimId/cleanup", async function _Cleanup(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _Controller(request, dependencies))
			{
				_Problem(response, 401, "controller_identity_denied");
				return;
			}
			const claimId = request.params["claimId"];
			if (!_Coordinate(claimId))
			{
				_Problem(response, 400, "invalid_mcp_runtime_cleanup");
				return;
			}
			let command;
			try
			{
				command = __ParseMcpRuntimeCleanupCommand(request.body);
			}
			catch
			{
				_Problem(response, 400, "invalid_mcp_runtime_cleanup");
				return;
			}
			const outcome = await dependencies.authority.commitCleanup(claimId, command);
			_WriteOutcome(response, outcome);
		}
		catch (err)
		{
			_Failure(response, dependencies, err, "agent_controller.mcp_executor_cleanup", "Agent-controller MCP executor cleanup failed");
		}
	});

	router.put("/mcp-executor/:claimId/pod-registration", async function _PodRegistration(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _Controller(request, dependencies))
			{
				_Problem(response, 401, "controller_identity_denied");
				return;
			}
			const claimId = request.params["claimId"];
			if (!_Coordinate(claimId))
			{
				_Problem(response, 400, "invalid_mcp_runtime_pod_registration");
				return;
			}
			let command;
			try
			{
				command = __ParseMcpRuntimePodRegistrationCommand(request.body);
			}
			catch
			{
				_Problem(response, 400, "invalid_mcp_runtime_pod_registration");
				return;
			}
			const outcome = await dependencies.authority.registerFirstPod(claimId, command);
			_WriteOutcome(response, outcome);
		}
		catch (err)
		{
			_Failure(response, dependencies, err, "agent_controller.mcp_executor_pod_registration", "Agent-controller MCP executor Pod registration failed");
		}
	});

	return router;
}

/** Review one bearer token and require every fixed controller coordinate. */
async function _Controller(request: Request, dependencies: McpRuntimeControllerRouterDependencies): Promise<boolean>
{
	const token = _Bearer(request.header("authorization"));
	if (token === null)
		return false;
	const identity = await dependencies.tokenReviewer.__Review(token);
	return identity !== null && _ControllerIdentity(identity, dependencies.serverNamespace);
}

/** Match TokenReview output to the exact controller identity fixed by deployment. */
function _ControllerIdentity(identity: ReviewedFixedServiceAccountIdentity, namespace: string): boolean
{
	return identity.username === `system:serviceaccount:${namespace}:${AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME}`
		&& identity.namespace === namespace
		&& identity.serviceAccountName === AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME
		&& identity.audiences.includes(AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE);
}

/** Read one unambiguous bearer credential. */
function _Bearer(value: string | undefined): string | null
{
	return /^Bearer ([^\s,]+)$/u.exec(value ?? "")?.[1] ?? null;
}

/** Accept the empty JSON command used by both controller polls. */
function _EmptyCommand(value: unknown): boolean
{
	return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;
}

/** Accept one bounded path coordinate without control characters. */
function _Coordinate(value: unknown): value is string
{
	return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(value);
}

/** Preserve the controller client's exact one-field outcome response. */
function _WriteOutcome(response: Response, outcome: "assigned" | "released" | "registered" | "cleaned" | "idempotent" | "conflict"): void
{
	if (outcome === "conflict")
	{
		_Problem(response, 409, "stale_or_conflicting_mcp_runtime_write");
		return;
	}
	response.status(200).json({ outcome });
}

/** Log an internal outage without request credentials or body data. */
function _Failure(response: Response, dependencies: McpRuntimeControllerRouterDependencies, err: unknown, operation: string, message: string): void
{
	dependencies.logger.error({ err, operation }, message);
	_Problem(response, 503, "mcp_runtime_authority_unavailable");
}

/** Send one short internal error response. */
function _Problem(response: Response, status: number, error: string): void
{
	response.status(status).json({ error });
}
