import { Router, type Request, type Response } from "express";

import { __ParseAgentRunWorkflowAssignmentRequest, __ParseAgentRunWorkflowAttemptKeyRevocationRequest, __ParseAgentRunWorkflowPodRequest, __ParseAgentRunWorkflowReleaseClaimRequest, __ParseAgentRunWorkflowTaskRequest } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import { AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE, AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME } from "@opencrane/contracts";

import type { AgentRunWorkflowControllerIdentity, AgentRunWorkflowControllerRouterDependencies } from "./agent-run-workflow-controller.router.types";

/**
 * Creates the controller-only API for the durable AgentRun workflow handler.
 *
 * Every operation checks the caller's projected controller identity before parsing a workflow task
 * receipt. The server then keeps lifecycle, database fencing, raw-key revocation, and terminal
 * state in one task-bound authority; HTTP only transports the controller's observed Kubernetes IDs.
 *
 * Called by: `_CreateControllerRuntimeComposition` in the OpenCrane app.
 * @param dependencies - Supplies the reviewed controller identity, server authority, and logger.
 * @returns A router mounted below `/api/internal/agent-controller`.
 */
export function __CreateAgentRunWorkflowControllerRouter(dependencies: AgentRunWorkflowControllerRouterDependencies): Router
{
	const router = Router();

	router.post("/agent-run-workflows/load", async function _Load(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			const command = __ParseAgentRunWorkflowTaskRequest(request.body);
			if (command === null)
			{
				_RespondProblem(response, 400, "invalid_agent_run_task");
				return;
			}
			const record = await dependencies.authority.loadForTask(command.input, command.task);
			if (record === null)
			{
				_RespondProblem(response, 409, "stale_or_unavailable_agent_run");
				return;
			}
			response.status(200).json(record);
		}
		catch (err)
		{
			_LogFailure(dependencies, err, "agent_controller.agent_run_workflow.load");
			_RespondProblem(response, 503, "agent_run_workflow_unavailable");
		}
	});

	router.post("/agent-run-workflows/mint-attempt-key", async function _MintAttemptKey(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			const command = __ParseAgentRunWorkflowTaskRequest(request.body);
			if (command === null)
			{
				_RespondProblem(response, 400, "invalid_agent_run_task");
				return;
			}
			const attemptKey = await dependencies.authority.mintAttemptKey(command.input, command.task);
			if (attemptKey === null)
			{
				_RespondProblem(response, 409, "stale_or_unavailable_agent_run");
				return;
			}
			response.status(200).json(attemptKey);
		}
		catch (err)
		{
			_LogFailure(dependencies, err, "agent_controller.agent_run_workflow.mint_attempt_key");
			_RespondProblem(response, 503, "agent_run_workflow_unavailable");
		}
	});

	router.post("/agent-run-workflows/revoke-attempt-key", async function _RevokeAttemptKey(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			const command = __ParseAgentRunWorkflowAttemptKeyRevocationRequest(request.body);
			if (command === null)
			{
				_RespondProblem(response, 400, "invalid_agent_run_key_revocation");
				return;
			}
			await dependencies.authority.revokeAttemptKey(command.input, command.task, command.attemptKey);
			response.status(204).end();
		}
		catch (err)
		{
			_LogFailure(dependencies, err, "agent_controller.agent_run_workflow.revoke_attempt_key");
			_RespondProblem(response, 503, "agent_run_workflow_unavailable");
		}
	});

	router.put("/agent-run-workflows/assignment", async function _BindAssignment(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			const command = __ParseAgentRunWorkflowAssignmentRequest(request.body);
			if (command === null)
			{
				_RespondProblem(response, 400, "invalid_agent_run_assignment");
				return;
			}
			const outcome = await dependencies.authority.bindAssignment(command.input, command.task, command.command);
			_RespondBinding(response, outcome);
		}
		catch (err)
		{
			_LogFailure(dependencies, err, "agent_controller.agent_run_workflow.assignment");
			_RespondProblem(response, 503, "agent_run_workflow_unavailable");
		}
	});

	router.put("/agent-run-workflows/first-pod", async function _BindFirstPod(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			const command = __ParseAgentRunWorkflowPodRequest(request.body);
			if (command === null)
			{
				_RespondProblem(response, 400, "invalid_agent_run_first_pod");
				return;
			}
			const outcome = await dependencies.authority.bindFirstPod(command.input, command.task, command.command);
			_RespondBinding(response, outcome);
		}
		catch (err)
		{
			_LogFailure(dependencies, err, "agent_controller.agent_run_workflow.first_pod");
			_RespondProblem(response, 503, "agent_run_workflow_unavailable");
		}
	});

	router.post("/agent-run-workflows/release-claim", async function _ClaimRelease(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			const command = __ParseAgentRunWorkflowReleaseClaimRequest(request.body);
			if (command === null)
			{
				_RespondProblem(response, 400, "invalid_agent_run_release_claim");
				return;
			}
			const claim = await dependencies.authority.claimRelease(command.input, command.task, command.workloadUid);
			if (claim === null)
			{
				_RespondProblem(response, 409, "stale_or_unavailable_agent_run");
				return;
			}
			response.status(200).json(claim);
		}
		catch (err)
		{
			_LogFailure(dependencies, err, "agent_controller.agent_run_workflow.release_claim");
			_RespondProblem(response, 503, "agent_run_workflow_unavailable");
		}
	});

	router.post("/agent-run-workflows/terminal-failure", async function _TerminalFailure(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			const command = __ParseAgentRunWorkflowTaskRequest(request.body);
			if (command === null)
			{
				_RespondProblem(response, 400, "invalid_agent_run_task");
				return;
			}
			await dependencies.authority.terminalizeFailedTask(command.input, command.task);
			response.status(204).end();
		}
		catch (err)
		{
			_LogFailure(dependencies, err, "agent_controller.agent_run_workflow.terminal_failure");
			_RespondProblem(response, 503, "agent_run_workflow_unavailable");
		}
	});

	router.post("/agent-run-workflows/observe", async function _Observe(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			const command = __ParseAgentRunWorkflowTaskRequest(request.body);
			if (command === null)
			{
				_RespondProblem(response, 400, "invalid_agent_run_task");
				return;
			}
			response.status(200).json(await dependencies.authority.observe(command.input, command.task));
		}
		catch (err)
		{
			_LogFailure(dependencies, err, "agent_controller.agent_run_workflow.observe");
			_RespondProblem(response, 503, "agent_run_workflow_unavailable");
		}
	});

	return router;
}

/** Checks the one controller ServiceAccount identity allowed to act for AgentRun tasks. */
async function _IsController(request: Request, dependencies: AgentRunWorkflowControllerRouterDependencies): Promise<boolean>
{
	const token = _BearerValue(request.header("authorization"));
	if (token === null)
	{
		return false;
	}
	const identity = await dependencies.tokenReviewer.__Review(token);
	return identity !== null && _IdentityMatches(identity, dependencies.namespace);
}

/** Compares each reviewed identity fact with the dedicated controller deployment identity. */
function _IdentityMatches(identity: AgentRunWorkflowControllerIdentity, namespace: string): boolean
{
	return identity.username === `system:serviceaccount:${namespace}:${AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME}`
		&& identity.namespace === namespace
		&& identity.serviceAccountName === AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME
		&& identity.audiences.includes(AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE);
}

/** Reads exactly one bearer value and rejects ambiguous authorization headers. */
function _BearerValue(value: string | undefined): string | null
{
	if (value === undefined)
	{
		return null;
	}
	return /^Bearer ([^\s,]+)$/u.exec(value)?.[1] ?? null;
}

/** Returns a binding result, or a conflict that stops a stale controller task. */
function _RespondBinding(response: Response, outcome: "bound" | "idempotent" | "conflict"): void
{
	if (outcome === "conflict")
	{
		_RespondProblem(response, 409, "stale_or_conflicting_agent_run");
		return;
	}
	response.status(200).json({ outcome });
}

/** Logs only a route name and error, leaving raw request values out of structured logs. */
function _LogFailure(dependencies: AgentRunWorkflowControllerRouterDependencies, err: unknown, operation: string): void
{
	dependencies.logger.error({ err, operation }, "AgentRun workflow controller request failed");
}

/** Returns one bounded internal problem response without durable state details. */
function _RespondProblem(response: Response, status: number, error: string): void
{
	response.status(status).json({ error });
}
