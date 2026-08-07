import { Router, type Request, type Response } from "express";

import { AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE, AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME, ___IsEmptyAgentControllerCommand, ___ParseAgentControllerRunAttemptAssignmentCommand, ___ParseAgentControllerRunWorkloadRegistrationCommand } from "@opencrane/contracts";

import { RunDispatchResultStatuses } from "./run-dispatch.types.js";
import type { AgentControllerRunDispatchRouterDependencies, ReviewedAgentControllerIdentity } from "./run-dispatch.types.js";

/**
 * Build the workload-authenticated internal run-dispatch API for the sole agent controller.
 *
 * The router accepts no caller-selected policy or time. It first verifies the dedicated projected
 * ServiceAccount token, then delegates all lease, membership, attempt, and assignment decisions to
 * the repository so HTTP parsing can never become a second run authority.
 */
export function __CreateAgentControllerRunDispatchRouter(dependencies: AgentControllerRunDispatchRouterDependencies): Router
{
	const router = Router();

	router.post("/run-attempts:claim", async function _claim(request: Request, response: Response)
	{
		try
		{
			// 1. TokenReview the dedicated controller credential and reject caller-supplied policy or time.
			if (!await _IsController(request, dependencies) || !___IsEmptyAgentControllerCommand(request.body))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}

			// 2. Claim one database-fenced command; an empty queue is normal long-poll input.
			const result = await dependencies.repository.claimNextAttemptAtomically();
			if (result.status === RunDispatchResultStatuses.None)
			{
				response.status(204).end();
				return;
			}
			response.status(200).json(result.claim);
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "agent_controller.claim" }, "Agent-controller claim failed");
			_RespondProblem(response, 503, "dispatch_authority_unavailable");
		}
	});

	router.put("/run-attempts/:eventId/assignment", async function _assign(request: Request, response: Response)
	{
		try
		{
			// 1. Authenticate before parsing assignment evidence so unauthorised callers learn no claim state.
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			const command = ___ParseAgentControllerRunAttemptAssignmentCommand(request.body);
			const eventId = request.params["eventId"];
			if (!command || typeof eventId !== "string" || !eventId)
			{
				_RespondProblem(response, 400, "invalid_assignment");
				return;
			}

			// 2. Let the run authority compare the exact claim generation and persist all state atomically.
			const result = await dependencies.repository.commitSuspendedJobAssignmentAtomically(eventId, command);
			if (result.status === RunDispatchResultStatuses.Conflict)
			{
				_RespondProblem(response, 409, result.reason);
				return;
			}
			response.status(200).json(result.result);
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "agent_controller.assignment" }, "Agent-controller assignment failed");
			_RespondProblem(response, 503, "dispatch_authority_unavailable");
		}
	});

	router.post("/workload-releases:claim", async function _claimRelease(request: Request, response: Response)
	{
		try
		{
			// 1. Authenticate the sole controller before revealing any pending workload coordinates.
			if (!await _IsController(request, dependencies) || !___IsEmptyAgentControllerCommand(request.body))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}

			// 2. Claim or terminalise one database-fenced release, including an expired queue head.
			const result = await dependencies.repository.claimNextWorkloadReleaseAtomically();
			if (result.status === RunDispatchResultStatuses.Terminalized)
			{
				dependencies.logger.warn({ eventId: result.eventId, runId: result.runId, attempt: result.attempt, failureCode: result.failureCode }, "Poisoned workload release terminalized after durable repair");
				response.status(204).end();
				return;
			}
			if (result.status === RunDispatchResultStatuses.None)
			{
				response.status(204).end();
				return;
			}
			response.status(200).json(result.claim);
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "agent_controller.release_claim" }, "Agent-controller workload release claim failed");
			_RespondProblem(response, 503, "dispatch_authority_unavailable");
		}
	});

	router.post("/run-outbox:prune", async function _pruneOutbox(request: Request, response: Response)
	{
		try
		{
			// 1. Restrict operational retention to the same TokenReview-confirmed controller identity.
			if (!await _IsController(request, dependencies) || !___IsEmptyAgentControllerCommand(request.body))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}

			// 2. Keep selection and deletion in the database-owned transaction, never in HTTP memory.
			response.status(200).json(await dependencies.repository.prunePublishedOutboxEventsAtomically());
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "agent_controller.outbox_prune" }, "Agent-controller outbox retention failed");
			_RespondProblem(response, 503, "dispatch_authority_unavailable");
		}
	});

	router.put("/workload-releases/:eventId/registration", async function _registerPod(request: Request, response: Response)
	{
		try
		{
			// 1. Authenticate before parsing Pod evidence so unauthorised callers learn no release state.
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			const command = ___ParseAgentControllerRunWorkloadRegistrationCommand(request.body);
			const eventId = request.params["eventId"];
			if (!command || typeof eventId !== "string" || !eventId)
			{
				_RespondProblem(response, 400, "invalid_registration");
				return;
			}

			// 2. Let the run authority register only the first Pod and publish the release atomically.
			const result = await dependencies.repository.registerFirstPodAndPublishReleaseAtomically(eventId, command);
			if (result.status === RunDispatchResultStatuses.Conflict)
			{
				_RespondProblem(response, 409, result.reason);
				return;
			}
			response.status(200).json(result.result);
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "agent_controller.pod_registration" }, "Agent-controller Pod registration failed");
			_RespondProblem(response, 503, "dispatch_authority_unavailable");
		}
	});

	return router;
}

/** TokenReview one bearer and require the exact controller KSA, namespace, username, and audience. */
async function _IsController(request: Request, dependencies: AgentControllerRunDispatchRouterDependencies): Promise<boolean>
{
	const token = _BearerValue(request.header("authorization"));
	if (!token) return false;
	const identity = await dependencies.tokenReviewer.__Review(token);
	return identity !== null && _IdentityMatches(identity, dependencies.namespace);
}

/** Require every independently reviewed workload coordinate to match fixed controller identity. */
function _IdentityMatches(identity: ReviewedAgentControllerIdentity, namespace: string): boolean
{
	return identity.username === `system:serviceaccount:${namespace}:${AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME}`
		&& identity.namespace === namespace
		&& identity.serviceAccountName === AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME
		&& identity.audiences.includes(AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE);
}

/** Read one unambiguous standard bearer credential. */
function _BearerValue(value: string | undefined): string | null
{
	if (!value) return null;
	return /^Bearer ([^\s,]+)$/u.exec(value)?.[1] ?? null;
}

/** Write one bounded, non-sensitive internal problem response. */
function _RespondProblem(response: Response, status: number, reason: string): void
{
	response.status(status).json({ error: reason });
}
