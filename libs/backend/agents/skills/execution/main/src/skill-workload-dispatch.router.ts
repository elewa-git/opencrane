import { Router, type Request, type Response } from "express";

import { AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE, AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME, ___IsEmptyAgentControllerCommand, ___ParseAgentControllerSkillWorkloadAssignmentCommand, ___ParseAgentControllerSkillWorkloadPodRegistrationCommand, ___ParseAgentControllerSkillWorkloadReleaseCommand } from "@opencrane/contracts";

import type { ReviewedSkillWorkloadControllerIdentity, SkillWorkloadDispatchRouterDependencies } from "./skill-workload-dispatch.types.js";

/**
 * Build the controller-authenticated internal API for governed skill workloads.
 *
 * The router does not choose work, Kubernetes policy, or capabilities. It authenticates the exact
 * controller identity then delegates the claim fence and immutable Job-UID assignment to Postgres.
 *
 * **This router is NOT behind `___AuthMiddleware`.** The server NetworkPolicy limits its listener
 * to the agent controller, while TokenReview verifies the controller's projected-token identity.
 *
 * @see apps/opencrane/helm/templates/_networkpolicy.tpl — restricts server ingress to the controller.
 * @see apps/agent-controller/helm/templates/_resources.tpl — projects the controller audience-bound token.
 */
export function __CreateSkillWorkloadDispatchRouter(dependencies: SkillWorkloadDispatchRouterDependencies): Router
{
	const router = Router();

	router.post("/skill-workloads:claim", async function _Claim(request: Request, response: Response): Promise<void>
	{
		try
		{
			// 1. Authenticate before exposing a pending workload or parsing caller-controlled data.
			if (!await _IsController(request, dependencies) || !___IsEmptyAgentControllerCommand(request.body))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}

			// 2. Let the database choose and fence exactly one eligible workload.
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
			dependencies.logger.error({ err, operation: "agent_controller.skill_workload_claim" }, "Agent-controller skill workload claim failed");
			_RespondProblem(response, 503, "skill_workload_authority_unavailable");
		}
	});

	router.put("/skill-workloads/:workloadId/assignment", async function _Assign(request: Request, response: Response): Promise<void>
	{
		try
		{
			// 1. Authenticate before parsing assignment evidence so another workload cannot probe claim state.
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			const command = ___ParseAgentControllerSkillWorkloadAssignmentCommand(request.body);
			const workloadId = request.params["workloadId"];
			if (command === null || typeof workloadId !== "string" || workloadId.length === 0)
			{
				_RespondProblem(response, 400, "invalid_assignment");
				return;
			}

			// 2. Commit only the exact database claim generation and Kubernetes-issued immutable UID.
			const outcome = await dependencies.authority.commitAssignmentAtomically(workloadId, command);
			if (outcome === "conflict")
			{
				_RespondProblem(response, 409, "stale_or_conflicting_assignment");
				return;
			}
			response.status(200).json({ outcome, workloadId, workloadUid: command.workloadUid });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "agent_controller.skill_workload_assignment" }, "Agent-controller skill workload assignment failed");
			_RespondProblem(response, 503, "skill_workload_authority_unavailable");
		}
	});

	router.post("/skill-workloads:release-claim", async function _ClaimRelease(request: Request, response: Response): Promise<void>
	{
		if (!await _IsController(request, dependencies) || !___IsEmptyAgentControllerCommand(request.body))
		{
			_RespondProblem(response, 401, "controller_identity_denied");
			return;
		}
		try
		{
			const claim = await dependencies.authority.claimNextReleaseAtomically();
			if (claim === null)
			{
				response.status(204).end();
				return;
			}
			response.status(200).json(claim);
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "agent_controller.skill_workload_release_claim" }, "Agent-controller skill workload release claim failed");
			_RespondProblem(response, 503, "skill_workload_authority_unavailable");
		}
	});

	router.put("/skill-workloads/:workloadId/release", async function _Release(request: Request, response: Response): Promise<void>
	{
		if (!await _IsController(request, dependencies))
		{
			_RespondProblem(response, 401, "controller_identity_denied");
			return;
		}
		const command = ___ParseAgentControllerSkillWorkloadReleaseCommand(request.body);
		const workloadId = request.params["workloadId"];
		if (command === null || typeof workloadId !== "string" || workloadId.length === 0)
		{
			_RespondProblem(response, 400, "invalid_release");
			return;
		}
		try
		{
			const outcome = await dependencies.authority.commitReleaseAtomically(workloadId, command);
			if (outcome === "conflict")
			{
				_RespondProblem(response, 409, "stale_or_conflicting_release");
				return;
			}
			response.status(200).json({ outcome, workloadId, workloadUid: command.workloadUid });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "agent_controller.skill_workload_release" }, "Agent-controller skill workload release commit failed");
			_RespondProblem(response, 503, "skill_workload_authority_unavailable");
		}
	});

	router.put("/skill-workloads/:workloadId/pod-registration", async function _RegisterFirstPod(request: Request, response: Response): Promise<void>
	{
		try
		{
			// 1. Authenticate before reading Pod evidence so it cannot become an identity oracle.
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			const command = ___ParseAgentControllerSkillWorkloadPodRegistrationCommand(request.body);
			const workloadId = request.params["workloadId"];
			if (command === null || typeof workloadId !== "string" || workloadId.length === 0)
			{
				_RespondProblem(response, 400, "invalid_pod_registration");
				return;
			}
			// 2. Persist only the exact release-fenced, Kubernetes-discovered immutable Pod UID.
			const outcome = await dependencies.authority.registerFirstPodAtomically(workloadId, command);
			if (outcome === "conflict")
			{
				_RespondProblem(response, 409, "stale_or_conflicting_pod_registration");
				return;
			}
			response.status(200).json({ outcome, workloadId, workloadUid: command.workloadUid, podUid: command.podUid });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "agent_controller.skill_workload_pod_registration" }, "Agent-controller skill workload Pod registration failed");
			_RespondProblem(response, 503, "skill_workload_authority_unavailable");
		}
	});

	return router;
}

/** TokenReview one bearer and require the exact controller KSA, namespace, username, and audience. */
async function _IsController(request: Request, dependencies: SkillWorkloadDispatchRouterDependencies): Promise<boolean>
{
	const token = _BearerValue(request.header("authorization"));
	if (token === null) return false;
	const identity = await dependencies.tokenReviewer.__Review(token);
	return identity !== null && _IdentityMatches(identity, dependencies.namespace);
}

/** Require every independently reviewed workload coordinate to match the fixed controller identity. */
function _IdentityMatches(identity: ReviewedSkillWorkloadControllerIdentity, namespace: string): boolean
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
