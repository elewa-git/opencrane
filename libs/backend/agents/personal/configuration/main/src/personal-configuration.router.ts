import { Router, type Request, type Response } from "express";

import { __DecidePersonalConfigurationChange } from "./personal-configuration-decision.js";
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
			if (result.outcome !== "denied") { response.status(200).json({ changeId, state: result.outcome }); return; }
			if (result.reason === "not_found_or_not_owner" || result.reason === "already_decided") { response.status(404).json({ error: "configuration_change_not_found" }); return; }
			if (result.reason === "persistence_unavailable") { response.status(503).json({ error: "configuration_decision_unavailable" }); return; }
			response.status(400).json({ error: "invalid_configuration_decision" });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "personal_configuration.decide", siloId: caller.siloId }, "Personal configuration decision failed");
			response.status(503).json({ error: "configuration_decision_unavailable" });
		}
	});
	return router;
}

/** Accept only the closed decision payload; callers cannot supply ownership or application fields. */
function _decision(body: unknown): { readonly decision: "accepted" | "rejected"; readonly rejectionReason: string | null } | null
{
	if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
	const values = body as Record<string, unknown>;
	if (values.decision === "accepted" && Object.keys(values).length === 1) return { decision: "accepted", rejectionReason: null };
	if (values.decision === "rejected" && typeof values.rejectionReason === "string" && Object.keys(values).length === 2) return { decision: "rejected", rejectionReason: values.rejectionReason };
	return null;
}
