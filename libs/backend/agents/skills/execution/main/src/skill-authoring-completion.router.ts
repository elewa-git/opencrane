import { Router, type Request, type Response } from "express";

import type { SkillAuthoringCheckReport, SkillAuthoringCompletionCommand, SkillAuthoringCompletionRouterDependencies } from "./skill-authoring-completion.types.js";

/** Fixed projected-token audience for the isolated authoring worker class. */
const _AUTHORING_AUDIENCE = "opencrane-skill-authoring";

/** Build the authoring-only worker completion boundary. */
export function __CreateSkillAuthoringCompletionRouter(dependencies: SkillAuthoringCompletionRouterDependencies): Router
{
	const router = Router();
	router.post("/skill-authoring-workloads:complete", async function _Complete(request: Request, response: Response): Promise<void>
	{
		// 1. Review against a route-owned audience before reading a worker-selected workload coordinate.
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

			// 2. Postgres compares this reviewed Pod to the consumed bootstrap before accepting a terminal result.
			const outcome = await dependencies.repository.completeAtomically(command, identity);
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

/** Parse one standard bearer value without accepting multiple credentials. */
function _Bearer(value: string | undefined): string | null
{
	return value && /^Bearer ([^\s,]+)$/u.test(value) ? /^Bearer ([^\s,]+)$/u.exec(value)?.[1] ?? null : null;
}

/** Parse the small authoring-specific terminal contract, refusing arbitrary result JSON. */
function _Command(value: unknown): SkillAuthoringCompletionCommand | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
	const body = value as Record<string, unknown>;
	if (body["outcome"] === "succeeded" && _HasKeys(body, ["workloadId", "outcome", "testReport", "scanResult"]) && _Coordinate(body["workloadId"]) && _Report(body["testReport"]) && _Report(body["scanResult"])) return { workloadId: body["workloadId"], outcome: "succeeded", testReport: body["testReport"], scanResult: body["scanResult"] };
	if (body["outcome"] === "failed" && _HasKeys(body, ["workloadId", "outcome", "failureCode"]) && _Coordinate(body["workloadId"]) && _FailureCode(body["failureCode"])) return { workloadId: body["workloadId"], outcome: "failed", failureCode: body["failureCode"] };
	return null;
}

/** Require exactly the listed keys so a worker cannot smuggle future policy through the boundary. */
function _HasKeys(value: Record<string, unknown>, expected: readonly string[]): boolean
{
	return Object.keys(value).length === expected.length && expected.every(function _HasKey(key): boolean { return key in value; });
}

/** Validate the durable workload coordinate before it reaches the persistence adapter. */
function _Coordinate(value: unknown): value is string
{
	return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Validate bounded, reviewable evidence rather than accepting a free-form worker JSON blob. */
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

/** Restrict a terminal technical failure to a portable stable code. */
function _FailureCode(value: unknown): value is string
{
	return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value);
}
