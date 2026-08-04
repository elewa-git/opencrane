import { Router, type Request, type Response } from "express";

import { RunAdmissionConcurrencyDenialReasons } from "@opencrane/backend/agents/execution/runs";
import { _ParsePersonalRunAdmissionRequestBody } from "./personal-run-admission.router.validator.js";
import { PersonalRunAdmissionDenialReasons, PersonalRunAdmissionOutcomes } from "./personal-run-admission.types.js";
import type { PersonalRunAdmissionRouterDependencies } from "./personal-run-admission.router.types.js";

/**
 * Creates `POST /api/v1/me/runs` for an authenticated user's personal conversation run.
 *
 * The browser can choose only the thread it participates in and an idempotency key. Subject,
 * silo, service, membership assertion, organisation, scope, dataset, and run identifier are all
 * resolved by trusted server authorities and are never read from the request body.
 */
export function __CreatePersonalRunAdmissionRouter(dependencies: PersonalRunAdmissionRouterDependencies): Router
{
	const router = Router();
	router.post("/", async function _admit(request: Request, response: Response)
	{
		const caller = dependencies.resolveCaller(request);
		if (caller === null)
		{
			response.status(401).json({ error: "run_authentication_required" });
			return;
		}
		const body = _ParsePersonalRunAdmissionRequestBody(request.body);
		if (body === null)
		{
			response.status(400).json({ error: "invalid_personal_run_request" });
			return;
		}
		try
		{
			const result = await dependencies.admission.admitPersonalRun({
				siloId: caller.siloId,
				executionSubjectId: caller.subjectId,
				threadId: body.threadId,
				requestIdempotencyKey: body.requestIdempotencyKey,
			});
			if (result.outcome === PersonalRunAdmissionOutcomes.Denied)
			{
				const status = _DenialStatus(result.reason);
				response.status(status).json({ error: "personal_run_not_admittable" });
				return;
			}
			if (result.outcome === PersonalRunAdmissionOutcomes.Accepted)
			{
				response.status(201).json({ runId: result.runId });
				return;
			}
			response.status(200).json({ runId: result.runId });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "run_admission.personal", siloId: caller.siloId }, "Personal run admission failed");
			response.status(503).json({ error: "personal_run_admission_unavailable" });
		}
	});
	return router;
}

/** Maps typed admission denials to stable transport status without exposing authority detail. */
function _DenialStatus(reason: string): number
{
	if (reason === RunAdmissionConcurrencyDenialReasons.AdmissionConcurrencyLimited)
	{
		return 429;
	}
	if (reason === PersonalRunAdmissionDenialReasons.PersistenceUnavailable)
	{
		return 503;
	}
	return 403;
}
