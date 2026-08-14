import { Router, type Request, type Response } from "express";

import type { SelfRunStatusRouterDependencies } from "./self-run-status.router.types";

/** Create the session-authenticated endpoint for a personal run's current status. */
export function __CreateSelfRunStatusRouter(dependencies: SelfRunStatusRouterDependencies): Router
{
	const router = Router();
	router.get("/", async function _list(request: Request, response: Response)
	{
		const caller = dependencies.resolveCaller(request);
		if (caller === null) { response.status(401).json({ error: "run_authentication_required" }); return; }
		try
		{
			const runs = await dependencies.repository.listOwned(caller.siloId, caller.subjectId);
			response.status(200).json({ runs });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "run_status.self_list", siloId: caller.siloId }, "Self run list read failed");
			response.status(503).json({ error: "run_status_unavailable" });
		}
	});
	router.get("/:runId", async function _status(request: Request, response: Response)
	{
		const caller = dependencies.resolveCaller(request);
		const runId = request.params["runId"];
		if (caller === null) { response.status(401).json({ error: "run_authentication_required" }); return; }
		if (typeof runId !== "string" || !runId.trim()) { response.status(400).json({ error: "invalid_run_identifier" }); return; }
		try
		{
			const run = await dependencies.repository.readOwned(runId, caller.siloId, caller.subjectId);
			if (run === null) { response.status(404).json({ error: "run_not_found" }); return; }
			response.status(200).json(run);
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "run_status.self", siloId: caller.siloId }, "Self run status read failed");
			response.status(503).json({ error: "run_status_unavailable" });
		}
	});
	return router;
}
