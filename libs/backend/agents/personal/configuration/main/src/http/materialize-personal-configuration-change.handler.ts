import type { Request, RequestHandler, Response } from "express";

import { PersonalConfigurationDecisionCodes } from "../decision/personal-configuration-decision.types.js";
import { __MaterializePersonalConfigurationChange } from "../materialization/personal-configuration-materialization.js";
import { PersonalConfigurationMaterializationCodes } from "../materialization/personal-configuration-materialization.types.js";
import { PersonalConfigurationHttpErrors, type PersonalConfigurationRouterDependencies } from "./personal-configuration.router.types.js";

/** Creates the accepted-proposal materialisation request handler. */
export function _CreateMaterializePersonalConfigurationChangeHandler(dependencies: PersonalConfigurationRouterDependencies): RequestHandler
{
	return async function _MaterializePersonalConfigurationChange(request: Request, response: Response): Promise<void>
	{
		// 1. Derive ownership and accept no mutable materialisation coordinates from the body.
		const caller = dependencies.resolveCaller(request);
		const changeId = request.params["changeId"];
		if (caller === null) { response.status(401).json({ error: PersonalConfigurationHttpErrors.AuthenticationRequired }); return; }
		if (typeof changeId !== "string" || changeId.trim().length === 0 || !_isEmptyObject(request.body)) { response.status(400).json({ error: PersonalConfigurationHttpErrors.InvalidMaterialization }); return; }

		try
		{
			// 2. Ask the cross-domain UoW-backed authority to create the future immutable revision.
			const result = await __MaterializePersonalConfigurationChange(dependencies.materializer, { siloId: caller.siloId, userId: caller.userId, changeId, materializedAt: dependencies.clock.now().toISOString() });
			if (result.outcome === PersonalConfigurationMaterializationCodes.Denied)
			{
				response.status(_materializationDenialStatus(result.reason)).json({ error: result.reason });
				return;
			}

			// 3. Return only the durable proposal state and newly created revision identity when applicable.
			response.status(200).json(result.outcome === PersonalConfigurationMaterializationCodes.Applied ? { changeId, state: PersonalConfigurationMaterializationCodes.Applied, agentRevisionId: result.agentRevisionId } : { changeId, state: PersonalConfigurationDecisionCodes.Accepted, materialized: false });
		}
		catch (error)
		{
			dependencies.logger.error({ err: error, operation: "personal_configuration.materialize", siloId: caller.siloId, changeId }, "Personal configuration materialization failed");
			response.status(503).json({ error: PersonalConfigurationHttpErrors.MaterializationUnavailable });
		}
	};
}

/** Map a materialisation refusal to a bounded self-only HTTP response. */
function _materializationDenialStatus(reason: PersonalConfigurationMaterializationCodes): number
{
	if (reason === PersonalConfigurationMaterializationCodes.PersistenceUnavailable) return 503;
	if (reason === PersonalConfigurationMaterializationCodes.NotFoundOrNotOwner) return 404;
	if (reason === PersonalConfigurationMaterializationCodes.NotAccepted || reason === PersonalConfigurationMaterializationCodes.StaleProposal) return 409;
	return 422;
}

/** Accept only an empty object when the server derives every materialisation coordinate. */
function _isEmptyObject(value: unknown): boolean
{
	return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
}
