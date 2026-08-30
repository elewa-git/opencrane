import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";

import { __ParseSkillAuthoringValidationCompletionRequest, __ParseSkillAuthoringValidationPodBindRequest, __ParseSkillAuthoringValidationRecoveryRequest, __ParseSkillAuthoringValidationReleaseRequest, __ParseSkillAuthoringValidationTaskReceipt, __ParseSkillAuthoringValidationUnboundExpiryRequest, __ParseSkillAuthoringValidationWorkloadBindRequest } from "@opencrane/backend/agents/skills/workflows/contract";
import { AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE, AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME } from "@opencrane/contracts";

import type { SkillAuthoringValidationControllerIdentity, SkillAuthoringValidationControllerRouterDependencies } from "./skill-authoring-validation-controller.router.types";

/**
 * Builds the controller-only API for one admitted skill-authoring validation.
 *
 * Every route reviews the controller's projected Kubernetes identity before it parses a task
 * receipt or exposes validation state. Conflicting authority outcomes return 409 so a stale
 * controller cannot treat an unrecorded Job or completion as accepted.
 *
 * Called by: `_CreateControllerRuntimeComposition` in the OpenCrane app.
 * @param dependencies - Fixed controller identity, authoring namespace, authority, and logger.
 * @returns A router mounted below `/api/internal/agent-controller`.
 */
export function __CreateSkillAuthoringValidationControllerRouter(dependencies: SkillAuthoringValidationControllerRouterDependencies): Router
{
	const router = Router();
	router.use(rateLimit({ windowMs: 60_000, limit: 1_000, standardHeaders: true, legacyHeaders: false, validate: { trustProxy: false } }));

	router.post("/skill-authoring-validations/:validationId/claim", async function _Claim(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			const validationId = _ValidationId(request);
			const task = __ParseSkillAuthoringValidationTaskReceipt(request.body);
			if (validationId === null || task === null)
			{
				_RespondProblem(response, 400, "invalid_validation_claim");
				return;
			}
			const record = await dependencies.authority.claimForTask(validationId, task);
			if (record === null)
			{
				_RespondProblem(response, 409, "stale_or_unavailable_validation");
				return;
			}
			response.status(200).json(record);
		}
		catch (err)
		{
			_LogFailure(dependencies, err, "agent_controller.skill_authoring_validation.claim");
			_RespondProblem(response, 503, "skill_authoring_validation_unavailable");
		}
	});

	router.put("/skill-authoring-validations/:validationId/workload-binding", async function _BindWorkload(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			const validationId = _ValidationId(request);
			const requestBody = __ParseSkillAuthoringValidationWorkloadBindRequest(request.body, dependencies.authoringNamespace);
			if (validationId === null || requestBody === null)
			{
				_RespondProblem(response, 400, "invalid_workload_binding");
				return;
			}
			const outcome = await dependencies.authority.bindWorkload(validationId, requestBody.task, requestBody.command);
			_RespondOutcome(response, outcome, validationId);
		}
		catch (err)
		{
			_LogFailure(dependencies, err, "agent_controller.skill_authoring_validation.workload_binding");
			_RespondProblem(response, 503, "skill_authoring_validation_unavailable");
		}
	});

	router.post("/skill-authoring-validations/:validationId/release-authorization", async function _AuthorizeRelease(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			const validationId = _ValidationId(request);
			const requestBody = __ParseSkillAuthoringValidationReleaseRequest(request.body);
			if (validationId === null || requestBody === null)
			{
				_RespondProblem(response, 400, "invalid_release_authorization");
				return;
			}
			const outcome = await dependencies.authority.authorizeRelease(validationId, requestBody.task, requestBody.binding);
			if (outcome === "conflict")
			{
				_RespondProblem(response, 409, "stale_or_conflicting_validation");
				return;
			}
			response.status(200).json(outcome === "expired" ? { outcome, validationId } : { ...outcome, validationId });
		}
		catch (err)
		{
			_LogFailure(dependencies, err, "agent_controller.skill_authoring_validation.release_authorization");
			_RespondProblem(response, 503, "skill_authoring_validation_unavailable");
		}
	});

	router.post("/skill-authoring-validations/:validationId/failure/unbound-expiry", async function _FailUnboundExpiry(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			const validationId = _ValidationId(request);
			const expiry = __ParseSkillAuthoringValidationUnboundExpiryRequest(request.body);
			if (validationId === null || expiry === null)
			{
				_RespondProblem(response, 400, "invalid_unbound_expiry");
				return;
			}
			const outcome = await dependencies.authority.failExpiredBeforeWorkload(validationId, expiry.task, expiry.claim);
			_RespondOutcome(response, outcome, validationId);
		}
		catch (err)
		{
			_LogFailure(dependencies, err, "agent_controller.skill_authoring_validation.unbound_expiry");
			_RespondProblem(response, 503, "skill_authoring_validation_unavailable");
		}
	});

	router.put("/skill-authoring-validations/:validationId/pod-binding", async function _BindPod(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			const validationId = _ValidationId(request);
			const requestBody = __ParseSkillAuthoringValidationPodBindRequest(request.body);
			if (validationId === null || requestBody === null)
			{
				_RespondProblem(response, 400, "invalid_pod_binding");
				return;
			}
			const outcome = await dependencies.authority.bindFirstPod(validationId, requestBody.task, requestBody.command);
			_RespondOutcome(response, outcome, validationId);
		}
		catch (err)
		{
			_LogFailure(dependencies, err, "agent_controller.skill_authoring_validation.pod_binding");
			_RespondProblem(response, 503, "skill_authoring_validation_unavailable");
		}
	});

	router.post("/skill-authoring-validations/:validationId/status/current", async function _LoadCurrentStatus(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			const validationId = _ValidationId(request);
			const task = __ParseSkillAuthoringValidationTaskReceipt(request.body);
			if (validationId === null || task === null)
			{
				_RespondProblem(response, 400, "invalid_status_load");
				return;
			}
			const status = await dependencies.authority.loadCurrentStatus(validationId, task);
			response.status(200).json({ status, validationId });
		}
		catch (err)
		{
			_LogFailure(dependencies, err, "agent_controller.skill_authoring_validation.status_current");
			_RespondProblem(response, 503, "skill_authoring_validation_unavailable");
		}
	});

	router.post("/skill-authoring-validations/:validationId/completion/current", async function _LoadCurrentCompletion(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			const validationId = _ValidationId(request);
			const task = __ParseSkillAuthoringValidationTaskReceipt(request.body);
			if (validationId === null || task === null)
			{
				_RespondProblem(response, 400, "invalid_completion_load");
				return;
			}
			const completion = await dependencies.authority.loadCurrentCompletion(validationId, task);
			if (completion === null)
			{
				response.status(204).end();
				return;
			}
			response.status(200).json(completion);
		}
		catch (err)
		{
			_LogFailure(dependencies, err, "agent_controller.skill_authoring_validation.completion_current");
			_RespondProblem(response, 503, "skill_authoring_validation_unavailable");
		}
	});

	router.post("/skill-authoring-validations/:validationId/failure/unreported", async function _FailUnreported(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			const validationId = _ValidationId(request);
			const recovery = __ParseSkillAuthoringValidationRecoveryRequest(request.body);
			if (validationId === null || recovery === null)
			{
				_RespondProblem(response, 400, "invalid_validation_recovery");
				return;
			}
			const outcome = await dependencies.authority.failUnreported(validationId, recovery.task, recovery.binding, recovery.reason);
			_RespondOutcome(response, outcome, validationId);
		}
		catch (err)
		{
			_LogFailure(dependencies, err, "agent_controller.skill_authoring_validation.failure_unreported");
			_RespondProblem(response, 503, "skill_authoring_validation_unavailable");
		}
	});

	router.post("/skill-authoring-validations/:validationId/completion/complete", async function _Complete(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			const validationId = _ValidationId(request);
			const requestBody = __ParseSkillAuthoringValidationCompletionRequest(request.body);
			if (validationId === null || requestBody === null || requestBody.completion.validationId !== validationId)
			{
				_RespondProblem(response, 400, "invalid_validation_completion");
				return;
			}
			const outcome = await dependencies.authority.complete(validationId, requestBody.completion, requestBody.task);
			_RespondOutcome(response, outcome, validationId);
		}
		catch (err)
		{
			_LogFailure(dependencies, err, "agent_controller.skill_authoring_validation.completion_complete");
			_RespondProblem(response, 503, "skill_authoring_validation_unavailable");
		}
	});

	return router;
}

/** Reads the bounded validation identity from a route parameter. */
function _ValidationId(request: Request): string | null
{
	const value = request.params["validationId"];
	return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : null;
}

/** TokenReviews the projected bearer token and checks every controller identity field. */
async function _IsController(request: Request, dependencies: SkillAuthoringValidationControllerRouterDependencies): Promise<boolean>
{
	const token = _BearerValue(request.header("authorization"));
	if (token === null)
	{
		return false;
	}
	const identity = await dependencies.tokenReviewer.__Review(token);
	return identity !== null && _IdentityMatches(identity, dependencies.namespace);
}

/** Checks the TokenReview identity instead of trusting request-body identity fields. */
function _IdentityMatches(identity: SkillAuthoringValidationControllerIdentity, namespace: string): boolean
{
	return identity.username === `system:serviceaccount:${namespace}:${AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME}`
		&& identity.namespace === namespace
		&& identity.serviceAccountName === AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME
		&& identity.audiences.includes(AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE);
}

/** Reads one bearer token and rejects extra credentials in the same header. */
function _BearerValue(value: string | undefined): string | null
{
	if (value === undefined)
	{
		return null;
	}
	return /^Bearer ([^\s,]+)$/u.exec(value)?.[1] ?? null;
}

/** Writes a terminal or retry-safe controller outcome without exposing authority state. */
function _RespondOutcome(response: Response, outcome: "authorized" | "bound" | "completed" | "expired" | "failed" | "idempotent" | "not_expired" | "conflict", validationId: string): void
{
	if (outcome === "conflict")
	{
		_RespondProblem(response, 409, "stale_or_conflicting_validation");
		return;
	}
	response.status(200).json({ outcome, validationId });
}

/** Records the safe operation name and error without request bodies or bearer credentials. */
function _LogFailure(dependencies: SkillAuthoringValidationControllerRouterDependencies, err: unknown, operation: string): void
{
	dependencies.logger.error({ err, operation }, "Skill authoring validation controller request failed");
}

/** Writes one short internal error response without disclosing validation state. */
function _RespondProblem(response: Response, status: number, error: string): void
{
	response.status(status).json({ error });
}
