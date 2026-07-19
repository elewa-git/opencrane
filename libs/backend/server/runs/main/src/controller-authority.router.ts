import { Router, type Request, type Response } from "express";
import * as k8s from "@kubernetes/client-node";

import type { ControllerAuthorityRouterDependencies, ControllerJobObservation, ControllerPodObservation } from "./controller-authority.types.js";

/**
 * Creates the controller-only internal authority router.
 *
 * This router is mounted only on OpenCrane's separate INTERNAL listener. It deliberately bypasses
 * browser session middleware but validates the controller's projected ServiceAccount token through
 * TokenReview before every authority operation.
 *
 * @see apps/opencrane/helm/templates/_networkpolicy.tpl
 * @see apps/agent-controller/helm/templates/_resources.tpl
 */
export function __CreateControllerAuthorityRouter(dependencies: ControllerAuthorityRouterDependencies): Router
{
	const router = Router();
	router.get("/desired", async function _desired(request: Request, response: Response)
	{
		if (!await _authenticate(request, response, dependencies)) return;
		try
		{
			const desired = await dependencies.repository.claimDesiredJob(dependencies.nowEpochMs());
			response.status(200).json({ desired });
		}
		catch
		{
			_problem(response, 503, "authority_unavailable");
		}
	});

	router.post("/workloads/job", async function _recordJob(request: Request, response: Response)
	{
		if (!await _authenticate(request, response, dependencies)) return;
		const observation = _jobObservation(request.body);
		if (observation === null)
		{
			_problem(response, 400, "invalid_observation");
			return;
		}
		try
		{
			response.status(200).json(await dependencies.repository.recordJob(observation, dependencies.nowEpochMs()));
		}
		catch
		{
			_problem(response, 409, "workload_rejected");
		}
	});

	router.post("/workloads/pod", async function _recordPod(request: Request, response: Response)
	{
		if (!await _authenticate(request, response, dependencies)) return;
		const observation = _podObservation(request.body);
		if (observation === null)
		{
			_problem(response, 400, "invalid_observation");
			return;
		}
		try
		{
			await dependencies.repository.recordPod(observation, dependencies.nowEpochMs());
			response.status(204).end();
		}
		catch
		{
			_problem(response, 409, "pod_rejected");
		}
	});
	return router;
}

/** Verify one exact projected controller token through the Kubernetes authority. */
async function _authenticate(request: Request, response: Response, dependencies: ControllerAuthorityRouterDependencies): Promise<boolean>
{
	const token = _bearer(request.header("authorization"));
	if (token === null)
	{
		_problem(response, 401, "controller_auth_required");
		return false;
	}
	try
	{
		const review = new k8s.V1TokenReview();
		review.spec = new k8s.V1TokenReviewSpec();
		review.spec.token = token;
		review.spec.audiences = [dependencies.identity.audience];
		const result = await dependencies.authApi.createTokenReview({ body: review });
		const status = result.status;
		const expectedUsername = `system:serviceaccount:${dependencies.identity.namespace}:${dependencies.identity.serviceAccountName}`;
		if (!status?.authenticated || !status.audiences?.includes(dependencies.identity.audience) || status.user?.username !== expectedUsername)
		{
			_problem(response, 401, "controller_denied");
			return false;
		}
		return true;
	}
	catch
	{
		_problem(response, 503, "identity_unavailable");
		return false;
	}
}

/** Parse one exact compact bearer value. */
function _bearer(value: string | undefined): string | null
{
	const match = /^Bearer ([^\s,]+)$/u.exec(value ?? "");
	return match?.[1] ?? null;
}

/** Parse an acknowledgement with only immutable server-selected run coordinates. */
function _jobObservation(value: unknown): ControllerJobObservation | null
{
	if (!_record(value)
		|| typeof value.runId !== "string"
		|| !Number.isSafeInteger(value.attempt)
		|| typeof value.workloadName !== "string"
		|| typeof value.workloadUid !== "string"
		|| !_identifier(value.runId)
		|| (value.attempt as number) < 1
		|| !_identifier(value.workloadName)
		|| !_identifier(value.workloadUid)) return null;
	return { runId: value.runId, attempt: value.attempt as number, workloadName: value.workloadName, workloadUid: value.workloadUid };
}

/** Parse a controller Pod observation with a first immutable Pod UID. */
function _podObservation(value: unknown): ControllerPodObservation | null
{
	const job = _jobObservation(value);
	if (job === null || !_record(value) || typeof value.podUid !== "string" || !_identifier(value.podUid)) return null;
	return { ...job, podUid: value.podUid };
}

/** Narrow untrusted JSON to a non-array record. */
function _record(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Require bounded non-whitespace identifiers while the persistence authority applies exact policy. */
function _identifier(value: string): boolean
{
	return value.trim().length > 0 && value.length <= 512;
}

/** Write a non-sensitive private-route problem. */
function _problem(response: Response, status: number, error: string): void
{
	response.status(status).json({ error });
}
