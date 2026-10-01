import { Router } from "express";

import type { Logger } from "@opencrane/backend/observability";

import { PersonalAgentToolsConflict, PersonalAgentToolsDenied, PersonalAgentToolsUnavailable } from "./personal-agent-tools.errors";
import type { PersonalAgentToolsAuthority, PersonalAgentToolsCallerResolver } from "./personal-agent-tools.types";
import { ___PersonalAgentToolsSchema } from "./personal-agent-tools.validator";

/** Creates the authenticated personal-agent tool read and replacement routes. */
export function _CreatePersonalAgentToolsRouter(authority: PersonalAgentToolsAuthority, resolveCaller: PersonalAgentToolsCallerResolver, logger: Pick<Logger, "warn">): Router
{
	const router = Router();
	router.get("/", async function _GetTools(request, response)
	{
		response.set("Cache-Control", "no-store");
		const caller = resolveCaller(request);
		if (caller === null)
			return void response.status(401).json({ error: "unauthorized" });
		try
		{
			response.json(await authority.getTools(caller));
		}
		catch (error)
		{
			if (error instanceof PersonalAgentToolsDenied)
				return void response.status(403).json({ error: "personal_agent_tools_denied" });
			if (error instanceof PersonalAgentToolsUnavailable)
				return void response.status(404).json({ error: "personal_agent_unavailable" });
			logger.warn({ err: new Error("Personal agent tool selection read failed"), siloId: caller.siloId }, "Personal agent tools unavailable");
			response.status(503).json({ error: "personal_agent_tools_unavailable" });
		}
	});
	router.put("/", async function _SetTools(request, response)
	{
		response.set("Cache-Control", "no-store");
		const caller = resolveCaller(request);
		if (caller === null)
			return void response.status(401).json({ error: "unauthorized" });
		const parsed = ___PersonalAgentToolsSchema.safeParse(request.body);
		if (!parsed.success)
			return void response.status(400).json({ error: "invalid_request" });
		try
		{
			response.json(await authority.setTools(caller, parsed.data));
		}
		catch (error)
		{
			if (error instanceof PersonalAgentToolsDenied)
				return void response.status(403).json({ error: "personal_agent_tools_denied" });
			if (error instanceof PersonalAgentToolsConflict)
				return void response.status(409).json({ error: "personal_agent_revision_changed" });
			if (error instanceof PersonalAgentToolsUnavailable)
				return void response.status(404).json({ error: "personal_agent_unavailable" });
			logger.warn({ err: new Error("Personal agent tool assignment failed"), siloId: caller.siloId }, "Personal agent tools unavailable");
			response.status(503).json({ error: "personal_agent_tools_unavailable" });
		}
	});
	return router;
}
