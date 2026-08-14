import { Router, type Request, type Response } from "express";

import { SkillAuthoringCompletionOutcomes, type SkillAuthoringCheckReport, type SkillAuthoringCompletionCommand, type SkillAuthoringCompletionRouterDependencies } from "./skill-authoring-completion.types";

/** Fixed projected-token audience for the isolated authoring worker class. */
const _AUTHORING_AUDIENCE = "opencrane-skill-authoring";

/**
 * Build the authoring-only worker completion boundary.
 *
 * **This router is NOT behind `___AuthMiddleware`.** It TokenReviews a rotating projected
 * ServiceAccount token, while Helm allows only governed authoring Pods to reach this listener.
 *
 * @see apps/opencrane/helm/templates/_networkpolicy.tpl — server ingress and worker egress floor.
 * @see apps/agent-controller/helm/templates/_resources.tpl — projected authoring-token audience.
 */
export function __CreateSkillAuthoringCompletionRouter(dependencies: SkillAuthoringCompletionRouterDependencies): Router
{
	const router = Router();
	router.post("/skill-authoring-workloads:complete", async function _Complete(request: Request, response: Response): Promise<void>
	{
		// 1. TokenReview against the audience this route fixes, before any worker-supplied id reaches Postgres.
		const token = _Bearer(request.header("authorization"));
		if (token === null)
		{
			response.status(401).json({ error: "worker_identity_denied" });
			return;
		}
		try
		{
			const identity = await dependencies.tokenReviewer.__Review(token, _AUTHORING_AUDIENCE);
			const command = _Command(request.body);
			if (identity === null)
			{
				response.status(401).json({ error: "worker_identity_denied" });
				return;
			}
			if (command === null)
			{
				response.status(400).json({ error: "invalid_completion" });
				return;
			}

			// 2. In one transaction, check the reviewed Pod is the same Pod that consumed the bootstrap, then move the workload to its final state.
			const outcome = await dependencies.authority.completeAtomically(command, identity);
			if (outcome !== "completed")
			{
				response.status(409).json({ error: "completion_unavailable" });
				return;
			}
			response.status(200).json({ completed: true });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "skill_authoring.completion" }, "Skill authoring completion failed");
			response.status(503).json({ error: "completion_authority_unavailable" });
		}
	});
	return router;
}

/** Read the token from a single `Bearer <token>` header, rejecting anything else. */
function _Bearer(value: string | undefined): string | null
{
	return value && /^Bearer ([^\s,]+)$/u.test(value) ? /^Bearer ([^\s,]+)$/u.exec(value)?.[1] ?? null : null;
}

/** Read the small completion body this route accepts, refusing any other JSON. */
function _Command(value: unknown): SkillAuthoringCompletionCommand | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
	const body = value as Record<string, unknown>;
	if (body["outcome"] === SkillAuthoringCompletionOutcomes.Succeeded && _HasKeys(body, ["workloadId", "outcome", "testReport", "scanResult"]) && _Coordinate(body["workloadId"]) && _Report(body["testReport"]) && _Report(body["scanResult"])) return { workloadId: body["workloadId"], outcome: SkillAuthoringCompletionOutcomes.Succeeded, testReport: body["testReport"], scanResult: body["scanResult"] };
	if (body["outcome"] === SkillAuthoringCompletionOutcomes.Failed && _HasKeys(body, ["workloadId", "outcome", "failureCode"]) && _Coordinate(body["workloadId"]) && _FailureCode(body["failureCode"])) return { workloadId: body["workloadId"], outcome: SkillAuthoringCompletionOutcomes.Failed, failureCode: body["failureCode"] };
	return null;
}

/** Require exactly these keys, so a worker cannot slip extra fields through this route. */
function _HasKeys(value: Record<string, unknown>, expected: readonly string[]): boolean
{
	return Object.keys(value).length === expected.length && expected.every(function _HasKey(key): boolean { return key in value; });
}

/** Check the workload id is short and free of control characters before it reaches the database. */
function _Coordinate(value: unknown): value is string
{
	return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Check the report has exactly the three expected fields, each within range, rather than accepting free-form JSON. */
function _Report(value: unknown): value is SkillAuthoringCheckReport
{
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const report = value as Record<string, unknown>;
	return _HasKeys(report, ["passed", "summary", "checksRun"])
		&& typeof report["passed"] === "boolean"
		&& typeof report["summary"] === "string"
		&& report["summary"].length > 0
		&& report["summary"].length <= 2_000
		&& !/[\u0000-\u001f\u007f]/.test(report["summary"])
		&& typeof report["checksRun"] === "number"
		&& Number.isSafeInteger(report["checksRun"])
		&& report["checksRun"] >= 0
		&& report["checksRun"] <= 10_000;
}

/** Accept a failure only as a short lowercase code, never as free text. */
function _FailureCode(value: unknown): value is string
{
	return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value);
}
