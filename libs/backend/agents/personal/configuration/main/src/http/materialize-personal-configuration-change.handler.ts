import type { Request, RequestHandler, Response } from "express";

import { PersonalConfigurationDecisionCodes } from "../decision/personal-configuration-decision.types";
import { __MaterializePersonalConfigurationChange } from "../materialization/personal-configuration-materialization";
import { PersonalConfigurationMaterializationCodes } from "../materialization/personal-configuration-materialization.types";
import { PersonalConfigurationHttpErrors, type PersonalConfigurationRouterDependencies } from "./personal-configuration.router.types";

/**
 * Creates the route that applies a proposal the user has already accepted.
 *
 * The caller supplies only the proposal id in the path, and the body must be an empty object;
 * the server adds the owner and the time before the transaction runs.
 *
 * The response carries only the proposal's state and, when one was created, the new revision id.
 * Ownership and database detail stay inside the domain: 404 covers both a missing proposal and
 * another user's, 409 means not accepted or stale, 422 means the model is unavailable, and 503
 * is the only status worth retrying — it means the write failed with the outcome unknown, so the
 * browser must re-read rather than assume.
 *
 * Called by: {@link __CreatePersonalConfigurationRouter}.
 *
 * @param dependencies - Repositories, clock and logger.
 * @returns An Express handler answering 200, 400, 401, 404, 409, 422 or 503.
 * @see PersonalConfigurationMaterializationUnitOfWork
 */
export function _CreateMaterializePersonalConfigurationChangeHandler(dependencies: PersonalConfigurationRouterDependencies): RequestHandler
{
	return async function _MaterializePersonalConfigurationChange(request: Request, response: Response): Promise<void>
	{
		// 1. Take the owner from the session, and require an empty body.
		const caller = dependencies.resolveCaller(request);
		const changeId = request.params["changeId"];
		if (caller === null) { response.status(401).json({ error: PersonalConfigurationHttpErrors.AuthenticationRequired }); return; }
		if (typeof changeId !== "string" || changeId.trim().length === 0 || !_isEmptyObject(request.body)) { response.status(400).json({ error: PersonalConfigurationHttpErrors.InvalidMaterialization }); return; }

		try
		{
			// 2. Ask the materialiser to create the new revision inside its transaction.
			const result = await __MaterializePersonalConfigurationChange(dependencies.materializer, { siloId: caller.siloId, userId: caller.userId, changeId, materializedAt: dependencies.clock.now().toISOString() });
			if (result.outcome === PersonalConfigurationMaterializationCodes.Denied)
			{
				response.status(_materializationDenialStatus(result.reason)).json({ error: result.reason });
				return;
			}

			// 3. Return the proposal's state, plus the new revision id when one was created.
			response.status(200).json(result.outcome === PersonalConfigurationMaterializationCodes.Applied ? { changeId, state: PersonalConfigurationMaterializationCodes.Applied, agentRevisionId: result.agentRevisionId } : { changeId, state: PersonalConfigurationDecisionCodes.Accepted, materialized: false });
		}
		catch (error)
		{
			dependencies.logger.error({ err: error, operation: "personal_configuration.materialize", siloId: caller.siloId, changeId }, "Personal configuration materialization failed");
			response.status(503).json({ error: PersonalConfigurationHttpErrors.MaterializationUnavailable });
		}
	};
}

/** Maps a refusal reason to its HTTP status code. */
function _materializationDenialStatus(reason: PersonalConfigurationMaterializationCodes): number
{
	if (reason === PersonalConfigurationMaterializationCodes.PersistenceUnavailable)
		return 503;
	if (reason === PersonalConfigurationMaterializationCodes.AuthorizationDenied)
		return 403;
	if (reason === PersonalConfigurationMaterializationCodes.NotFoundOrNotOwner)
		return 404;
	if (reason === PersonalConfigurationMaterializationCodes.NotAccepted || reason === PersonalConfigurationMaterializationCodes.StaleProposal)
		return 409;
	return 422;
}

/** Returns whether the body is an empty object; the server supplies every other value. */
function _isEmptyObject(value: unknown): boolean
{
	return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
}
