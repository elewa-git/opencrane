import { Router, type Request, type Response } from "express";

import { __DecidePersonalConfigurationChange } from "./personal-configuration-decision.js";
import { __MaterializePersonalConfigurationChange } from "./personal-configuration-materialization.js";
import { PersonalConfigurationDecisionCodes } from "./personal-configuration.types.js";
import { PersonalConfigurationMaterializationCodes } from "./personal-configuration-materialization.types.js";
import type { PersonalConfigurationRouterDependencies } from "./personal-configuration.router.types.js";

/** Create the browser-session-authenticated personal configuration proposal state router. */
export function __CreatePersonalConfigurationRouter(dependencies: PersonalConfigurationRouterDependencies): Router
{
	const router = Router();
	router.get("/changes", async function _list(request: Request, response: Response)
	{
		const caller = dependencies.resolveCaller(request);
		if (caller === null) { response.status(401).json({ error: "configuration_authentication_required" }); return; }
		try
		{
			const changes = await dependencies.changes.listOwned(caller.siloId, caller.userId);
			response.status(200).json({ changes });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "personal_configuration.list", siloId: caller.siloId }, "Personal configuration list failed");
			response.status(503).json({ error: "configuration_list_unavailable" });
		}
	});
	router.post("/changes/:changeId/decision", async function _decide(request: Request, response: Response)
	{
		const caller = dependencies.resolveCaller(request);
		const changeId = request.params["changeId"];
		const decision = _decision(request.body);
		if (caller === null) { response.status(401).json({ error: "configuration_authentication_required" }); return; }
		if (typeof changeId !== "string" || changeId.trim().length === 0 || decision === null) { response.status(400).json({ error: "invalid_configuration_decision" }); return; }
		try
		{
			const result = await __DecidePersonalConfigurationChange(dependencies.decisions, { siloId: caller.siloId, userId: caller.userId, changeId, decision: decision.decision, rejectionReason: decision.rejectionReason, decidedAt: dependencies.clock.now().toISOString() });
			if (result.outcome !== PersonalConfigurationDecisionCodes.Denied) { response.status(200).json({ changeId, state: result.outcome }); return; }
			if (result.reason === PersonalConfigurationDecisionCodes.NotFoundOrNotOwner || result.reason === PersonalConfigurationDecisionCodes.AlreadyDecided) { response.status(404).json({ error: "configuration_change_not_found" }); return; }
			if (result.reason === PersonalConfigurationDecisionCodes.PersistenceUnavailable) { response.status(503).json({ error: "configuration_decision_unavailable" }); return; }
			response.status(400).json({ error: "invalid_configuration_decision" });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "personal_configuration.decide", siloId: caller.siloId }, "Personal configuration decision failed");
			response.status(503).json({ error: "configuration_decision_unavailable" });
		}
	});
	router.post("/changes/:changeId/materialize", async function _materialize(request: Request, response: Response)
	{
		const caller = dependencies.resolveCaller(request);
		const changeId = request.params["changeId"];
		if (caller === null) { response.status(401).json({ error: "configuration_authentication_required" }); return; }
		if (typeof changeId !== "string" || changeId.trim().length === 0 || !_isEmptyObject(request.body)) { response.status(400).json({ error: "invalid_configuration_materialization" }); return; }

		try
		{
			const result = await __MaterializePersonalConfigurationChange(dependencies.materializer, { siloId: caller.siloId, userId: caller.userId, changeId, materializedAt: dependencies.clock.now().toISOString() });
			if (result.outcome === PersonalConfigurationMaterializationCodes.Denied)
			{
				response.status(_materializationDenialStatus(result.reason)).json({ error: result.reason });
				return;
			}

			response.status(200).json(result.outcome === PersonalConfigurationMaterializationCodes.Applied ? { changeId, state: PersonalConfigurationMaterializationCodes.Applied, agentRevisionId: result.agentRevisionId } : { changeId, state: PersonalConfigurationDecisionCodes.Accepted, materialized: false });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "personal_configuration.materialize", siloId: caller.siloId, changeId }, "Personal configuration materialization failed");
			response.status(503).json({ error: "configuration_materialization_unavailable" });
		}
	});

	return router;
}

/** Accept only the closed decision payload; callers cannot supply ownership or application fields. */
function _decision(body: unknown): { readonly decision: PersonalConfigurationDecisionCodes.Accepted | PersonalConfigurationDecisionCodes.Rejected; readonly rejectionReason: string | null } | null
{
	if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
	const values = body as Record<string, unknown>;
	if (values.decision === PersonalConfigurationDecisionCodes.Accepted && Object.keys(values).length === 1) return { decision: PersonalConfigurationDecisionCodes.Accepted, rejectionReason: null };
	if (values.decision === PersonalConfigurationDecisionCodes.Rejected && typeof values.rejectionReason === "string" && Object.keys(values).length === 2) return { decision: PersonalConfigurationDecisionCodes.Rejected, rejectionReason: values.rejectionReason };
	return null;
}

/** Map an accepted-proposal materialization refusal to a bounded self-only HTTP response. */
function _materializationDenialStatus(reason: string): number
{
	if (reason === PersonalConfigurationMaterializationCodes.PersistenceUnavailable) return 503;
	if (reason === PersonalConfigurationMaterializationCodes.NotFoundOrNotOwner) return 404;
	if (reason === PersonalConfigurationMaterializationCodes.NotAccepted || reason === PersonalConfigurationMaterializationCodes.StaleProposal) return 409;
	return 422;
}

/** Accept only an empty object when the server derives every materialization coordinate. */
function _isEmptyObject(value: unknown): boolean
{
	return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
}
