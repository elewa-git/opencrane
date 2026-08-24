import { Router, type Request, type Response } from "express";

import { z } from "zod";
import { ___ParseAgentControllerMcpbValidationAssignmentCommand } from "@opencrane/contracts";

import type { McpbValidationControllerRouterDependencies } from "./mcpb-validation-controller.types";

/** Accepts the claim fence and bounded Job UID needed to record one controller assignment. */
/** Accepts no claim fields, so a caller cannot choose which saved workload to receive. */
const _EMPTY_COMMAND = z.object({}).strict();

/** Return a bearer token without exposing it to logs or response bodies. */
function _Bearer(request: Request): string | null
{
	const value = request.header("authorization");
	if (!value?.startsWith("Bearer "))
		return null;
	const token = value.slice("Bearer ".length).trim();
	return token.length > 0 ? token : null;
}

/** Write the one fixed problem shape for an internal controller request. */
function _Problem(response: Response, status: number, error: string): void
{
	response.status(status).json({ error });
}

/** Check the controller identity before parsing or exposing workload data. */
async function _IsController(request: Request, dependencies: McpbValidationControllerRouterDependencies): Promise<boolean>
{
	const token = _Bearer(request);
	return token !== null && await dependencies.tokenReviewer.__Review(token) !== null;
}

/**
 * Builds the controller-only API that claims MCP bundle validation work and records its Kubernetes Job.
 *
 * It reviews the projected token before it returns a claim or changes an assignment. A conflict
 * returns 409, so a controller that lost its database lease cannot treat its Job as assigned.
 * Called by: `_CreateControllerRuntimeComposition` in the OpenCrane app.
 * @param dependencies - Supplies token review, database authority, and structured error logging.
 * @returns A router mounted below `/api/internal/agent-controller`.
 */
export function __CreateMcpbValidationControllerRouter(dependencies: McpbValidationControllerRouterDependencies): Router
{
	const router = Router();
	router.post("/mcpb-validations:claim", async function _Claim(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsController(request, dependencies) || !_EMPTY_COMMAND.safeParse(request.body).success)
			{
				_Problem(response, 401, "controller_identity_denied");
				return;
			}
			const claim = await dependencies.authority.claimNextAtomically();
			if (claim === null)
			{
				response.status(204).end();
				return;
			}
			response.status(200).json(claim);
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "agent_controller.mcpb_validation_claim" }, "MCP bundle validation workload claim failed");
			_Problem(response, 503, "mcpb_validation_authority_unavailable");
		}
	});
	router.put("/mcpb-validations/:workloadId/assignment", async function _Assignment(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsController(request, dependencies))
			{
				_Problem(response, 401, "controller_identity_denied");
				return;
			}
			const assignment = ___ParseAgentControllerMcpbValidationAssignmentCommand(request.body);
			const workloadId = request.params["workloadId"];
			if (assignment === null || typeof workloadId !== "string" || workloadId.trim().length === 0)
			{
				_Problem(response, 400, "invalid_assignment");
				return;
			}
			const outcome = await dependencies.authority.commitAssignmentAtomically(workloadId, assignment);
			if (outcome === "conflict")
			{
				_Problem(response, 409, "stale_or_conflicting_assignment");
				return;
			}
			response.status(200).json({ outcome, workloadId, workloadUid: assignment.workloadUid });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "agent_controller.mcpb_validation_assignment" }, "MCP bundle validation workload assignment failed");
			_Problem(response, 503, "mcpb_validation_authority_unavailable");
		}
	});
	return router;
}
