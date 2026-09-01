import { Router, type Request, type Response } from "express";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import { SelfRunCancellationOutcomes, type SelfRunCancellationResult, type SelfRunCancellationRouterDependencies } from "./self-run-cancellation.types";
import { _ParseSelfRunCancellationBody } from "./self-run-cancellation.validator";

/** Stable owner-facing error codes for cancellation denials. */
const _ERROR_BY_OUTCOME: Readonly<Record<Exclude<SelfRunCancellationOutcomes, SelfRunCancellationOutcomes.Cancelling | SelfRunCancellationOutcomes.Cancelled>, string>> = {
	[SelfRunCancellationOutcomes.NotFound]: "run_not_found",
	[SelfRunCancellationOutcomes.AttemptConflict]: "run_attempt_conflict",
	[SelfRunCancellationOutcomes.TerminalRun]: "run_already_terminal",
	[SelfRunCancellationOutcomes.AuthorityConflict]: "run_cancellation_conflict",
	[SelfRunCancellationOutcomes.InvalidRequest]: "invalid_run_cancellation",
};

/** Create the session-authenticated endpoint that cancels one owner-observed run attempt. */
export function __CreateSelfRunCancellationRouter(dependencies: SelfRunCancellationRouterDependencies): Router
{
	const router = Router();
	router.post("/:runId/cancellation", async function _cancel(request: Request, response: Response)
	{
		const caller = dependencies.resolveCaller(request);
		const runId = request.params["runId"];
		if (caller === null) { response.status(401).json({ error: "run_authentication_required" }); return; }
		const body = _ParseSelfRunCancellationBody(request.body);
		if (typeof runId !== "string" || !runId.trim() || body === null) { response.status(400).json({ error: "invalid_run_cancellation" }); return; }
		try
		{
			const result = await ___DoWithTrace("run.cancellation.request", { runId, siloId: caller.siloId, expectedAttempt: body.expectedAttempt }, async function _requestCancellation()
			{
				return dependencies.cancellation.requestOwned({ runId, expectedAttempt: body.expectedAttempt, siloId: caller.siloId, principalId: caller.principalId });
			});
			_RespondToCancellation(response, result);
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "run_cancellation.self", siloId: caller.siloId }, "Self run cancellation failed");
			response.status(503).json({ error: "run_cancellation_unavailable" });
		}
	});
	return router;
}

/** Maps the cancellation result to its HTTP status, without revealing whether another owner has this run. */
function _RespondToCancellation(response: Response, result: SelfRunCancellationResult): void
{
	if (result.outcome === SelfRunCancellationOutcomes.Cancelling)
	{
		response.status(202).json({ runId: result.runId, attempt: result.attempt, state: result.outcome });
		return;
	}
	if (result.outcome === SelfRunCancellationOutcomes.Cancelled)
	{
		response.status(200).json({ runId: result.runId, attempt: result.attempt, state: result.outcome });
		return;
	}
	if (result.outcome === SelfRunCancellationOutcomes.NotFound)
	{
		response.status(404).json({ error: _ERROR_BY_OUTCOME[result.outcome] });
		return;
	}
	if (result.outcome === SelfRunCancellationOutcomes.InvalidRequest)
	{
		response.status(400).json({ error: _ERROR_BY_OUTCOME[result.outcome] });
		return;
	}
	response.status(409).json({ error: _ERROR_BY_OUTCOME[result.outcome] });
}
