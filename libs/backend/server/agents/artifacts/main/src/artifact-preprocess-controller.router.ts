import { Router, type Request, type Response } from "express";

import { __ParseArtifactPreprocessPodBindRequest, __ParseArtifactPreprocessRecoveryRequest, __ParseArtifactPreprocessTaskReceipt, __ParseArtifactPreprocessWorkloadBindRequest } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import type { ArtifactPreprocessCompletion } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import { AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE, AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME } from "@opencrane/contracts";

import type { ArtifactPreprocessControllerIdentity, ArtifactPreprocessControllerRouterDependencies } from "./artifact-preprocess-controller.router.types";

/**
 * Builds the private API a controller uses to claim and bind a saved PDF conversion task.
 *
 * Each route checks the controller's projected Kubernetes identity before it reads a task receipt
 * or returns job state. A stale or conflicting authority result returns 409, so a controller
 * cannot use an unrecorded Job as if the server accepted it.
 *
 * @param dependencies - Supplies the controller identity, worker namespace, authority, and logger.
 * @returns An Express router mounted below `/api/internal/agent-controller`.
 */
export function __CreateArtifactPreprocessControllerRouter(dependencies: ArtifactPreprocessControllerRouterDependencies): Router
{
	const router = Router();

	router.post("/artifact-preprocess-jobs/:preprocessJobId/claim", async function _Claim(request: Request, response: Response): Promise<void>
	{
		try
		{
			// 1. Authenticate before parsing a receipt so another workload cannot probe PDF task state.
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}

			// 2. Issue a record only for the exact durable task that PDF publication saved.
			const preprocessJobId = _PreprocessJobId(request);
			const task = __ParseArtifactPreprocessTaskReceipt(request.body);
			if (preprocessJobId === null || task === null)
			{
				_RespondProblem(response, 400, "invalid_preprocess_claim");
				return;
			}
			const record = await dependencies.authority.claimForTask(preprocessJobId, task);
			if (record === null)
			{
				_RespondProblem(response, 409, "stale_or_unavailable_preprocess_job");
				return;
			}
			response.status(200).json(record);
		}
		catch (err)
		{
			_LogFailure(dependencies, err, "agent_controller.artifact_preprocess.claim");
			_RespondProblem(response, 503, "artifact_preprocess_unavailable");
		}
	});

	router.put("/artifact-preprocess-jobs/:preprocessJobId/workload-binding", async function _BindWorkload(request: Request, response: Response): Promise<void>
	{
		try
		{
			// 1. Authenticate before parsing Kubernetes identifiers so callers cannot probe a claim delivery.
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}

			// 2. Bind only the delivery fence and worker namespace selected by the server profile.
			const preprocessJobId = _PreprocessJobId(request);
			const requestBody = __ParseArtifactPreprocessWorkloadBindRequest(request.body, dependencies.workerNamespace);
			if (preprocessJobId === null || requestBody === null)
			{
				_RespondProblem(response, 400, "invalid_workload_binding");
				return;
			}
			const outcome = await dependencies.authority.bindWorkload(preprocessJobId, requestBody.task, requestBody.command);
			_RespondOutcome(response, outcome, preprocessJobId);
		}
		catch (err)
		{
			_LogFailure(dependencies, err, "agent_controller.artifact_preprocess.workload_binding");
			_RespondProblem(response, 503, "artifact_preprocess_unavailable");
		}
	});

	router.put("/artifact-preprocess-jobs/:preprocessJobId/pod-binding", async function _BindPod(request: Request, response: Response): Promise<void>
	{
		try
		{
			// 1. Authenticate before parsing Pod identity so callers cannot test whether a Job claim exists.
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}

			// 2. Bind only the first Pod that carries the original Job delivery fence.
			const preprocessJobId = _PreprocessJobId(request);
			const requestBody = __ParseArtifactPreprocessPodBindRequest(request.body);
			if (preprocessJobId === null || requestBody === null)
			{
				_RespondProblem(response, 400, "invalid_pod_binding");
				return;
			}
			const outcome = await dependencies.authority.bindFirstPod(preprocessJobId, requestBody.task, requestBody.command);
			_RespondOutcome(response, outcome, preprocessJobId);
		}
		catch (err)
		{
			_LogFailure(dependencies, err, "agent_controller.artifact_preprocess.pod_binding");
			_RespondProblem(response, 503, "artifact_preprocess_unavailable");
		}
	});

	router.post("/artifact-preprocess-jobs/:preprocessJobId/outcome/load", async function _LoadOutcome(request: Request, response: Response): Promise<void>
	{
		try
		{
			// 1. Authenticate before reading completion evidence, which belongs to the server-owned inbox.
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			// 2. Return only the completion that the admitted task and requested delivery identify together.
			const preprocessJobId = _PreprocessJobId(request);
			const deliveryCount = _DeliveryCount(request.body);
			const task = deliveryCount === null ? null : __ParseArtifactPreprocessTaskReceipt((request.body as Record<string, unknown>)["task"]);
			if (preprocessJobId === null || deliveryCount === null || task === null)
			{
				_RespondProblem(response, 400, "invalid_outcome_load");
				return;
			}
			const outcome = await dependencies.authority.loadOutcome(preprocessJobId, deliveryCount, task);
			if (outcome === null)
			{
				_RespondProblem(response, 409, "stale_or_unavailable_outcome");
				return;
			}
			response.status(200).json(outcome);
		}
		catch (err)
		{
			_LogFailure(dependencies, err, "agent_controller.artifact_preprocess.outcome_load");
			_RespondProblem(response, 503, "artifact_preprocess_unavailable");
		}
	});

	router.post("/artifact-preprocess-jobs/:preprocessJobId/recovery/failure", async function _RecordRecoveryFailure(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			const preprocessJobId = _PreprocessJobId(request);
			const requestBody = __ParseArtifactPreprocessRecoveryRequest(request.body);
			if (preprocessJobId === null || requestBody === null)
			{
				_RespondProblem(response, 400, "invalid_recovery_failure");
				return;
			}
			const outcome = await dependencies.authority.recordUnreportedFailure(preprocessJobId, requestBody.task, requestBody.command);
			if (outcome === null)
			{
				_RespondProblem(response, 409, "stale_or_conflicting_preprocess_job");
				return;
			}
			response.status(200).json(outcome);
		}
		catch (err)
		{
			_LogFailure(dependencies, err, "agent_controller.artifact_preprocess.recovery_failure");
			_RespondProblem(response, 503, "artifact_preprocess_unavailable");
		}
	});

	router.post("/artifact-preprocess-jobs/:preprocessJobId/completion/complete", async function _Complete(request: Request, response: Response): Promise<void>
	{
		try
		{
			// 1. Authenticate before reading completion evidence so another workload cannot replay a task receipt.
			if (!await _IsController(request, dependencies))
			{
				_RespondProblem(response, 401, "controller_identity_denied");
				return;
			}
			// 2. Apply only evidence that names the same PDF job as the requested route.
			const preprocessJobId = _PreprocessJobId(request);
			const completion = _Completion(request.body);
			const task = completion === null ? null : __ParseArtifactPreprocessTaskReceipt((request.body as Record<string, unknown>)["task"]);
			if (preprocessJobId === null || completion === null || task === null || completion.preprocessJobId !== preprocessJobId)
			{
				_RespondProblem(response, 400, "invalid_completion");
				return;
			}
			const outcome = await dependencies.authority.complete(preprocessJobId, completion, task);
			_RespondCompletionOutcome(response, outcome, preprocessJobId);
		}
		catch (err)
		{
			_LogFailure(dependencies, err, "agent_controller.artifact_preprocess.completion_complete");
			_RespondProblem(response, 503, "artifact_preprocess_unavailable");
		}
	});

	return router;
}

/** Reads the bounded PDF preprocessing job identifier from the request path. */
function _PreprocessJobId(request: Request): string | null
{
	const value = request.params["preprocessJobId"];
	return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : null;
}

/** Reads the delivery count from a strict controller outcome request. */
function _DeliveryCount(value: unknown): number | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value))
	{
		return null;
	}
	const body = value as Record<string, unknown>;
	return Object.keys(body).length === 2 && typeof body["deliveryCount"] === "number" && Number.isSafeInteger(body["deliveryCount"]) && body["deliveryCount"] > 0 ? body["deliveryCount"] : null;
}

/** Reads the completion identity from a strict controller terminal-write request. */
function _Completion(value: unknown): ArtifactPreprocessCompletion | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value))
	{
		return null;
	}
	const body = value as Record<string, unknown>;
	const completion = body["completion"];
	if (Object.keys(body).length !== 2 || completion === null || typeof completion !== "object" || Array.isArray(completion))
	{
		return null;
	}
	const record = completion as Record<string, unknown>;
	return Object.keys(record).length === 2 && typeof record["preprocessJobId"] === "string" && record["preprocessJobId"].length > 0 && typeof record["completionDigest"] === "string" && /^sha256:[a-f0-9]{64}$/u.test(record["completionDigest"])
		? { preprocessJobId: record["preprocessJobId"], completionDigest: record["completionDigest"] }
		: null;
}

/** Reviews the projected bearer token and checks every controller identity field the server owns. */
async function _IsController(request: Request, dependencies: ArtifactPreprocessControllerRouterDependencies): Promise<boolean>
{
	const token = _BearerValue(request.header("authorization"));
	if (token === null)
	{
		return false;
	}
	const identity = await dependencies.tokenReviewer.__Review(token);
	return identity !== null && _IdentityMatches(identity, dependencies.namespace);
}

/** Checks TokenReview fields instead of trusting a namespace or identity supplied in the request body. */
function _IdentityMatches(identity: ArtifactPreprocessControllerIdentity, namespace: string): boolean
{
	return identity.username === `system:serviceaccount:${namespace}:${AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME}`
		&& identity.namespace === namespace
		&& identity.serviceAccountName === AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME
		&& identity.audiences.includes(AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE);
}

/** Reads a single bearer token and rejects extra credentials in the same header. */
function _BearerValue(value: string | undefined): string | null
{
	if (value === undefined)
	{
		return null;
	}
	return /^Bearer ([^\s,]+)$/u.exec(value)?.[1] ?? null;
}

/** Writes a successful binding result or hides a stale delivery behind a conflict response. */
function _RespondOutcome(response: Response, outcome: "bound" | "idempotent" | "conflict", preprocessJobId: string): void
{
	if (outcome === "conflict")
	{
		_RespondProblem(response, 409, "stale_or_conflicting_preprocess_job");
		return;
	}
	response.status(200).json({ outcome, preprocessJobId });
}

/** Writes a completion outcome using the controller client's terminal result vocabulary. */
function _RespondCompletionOutcome(response: Response, outcome: "completed" | "idempotent" | "conflict", preprocessJobId: string): void
{
	if (outcome === "conflict")
	{
		_RespondProblem(response, 409, "stale_or_conflicting_preprocess_job");
		return;
	}
	response.status(200).json({ outcome: outcome === "completed" ? "bound" : "idempotent", preprocessJobId });
}

/** Records a safe operation name and error without logging a bearer token or request body. */
function _LogFailure(dependencies: ArtifactPreprocessControllerRouterDependencies, err: unknown, operation: string): void
{
	dependencies.logger.error({ err, operation }, "Artifact preprocessing controller request failed");
}

/** Writes one short private API error without exposing authority state. */
function _RespondProblem(response: Response, status: number, error: string): void
{
	response.status(status).json({ error });
}
