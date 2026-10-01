import { Router } from "express";
import type { Logger } from "@opencrane/backend/observability";

import type { CompanyAssistantProvisioningAuthority, CompanyAssistantProvisioningCallerResolver } from "./company-assistant-provisioning.types";
import { ___CompanyAssistantProvisioningSchema, ___CompanyAssistantToolsSchema } from "./company-assistant-provisioning.validator";
import { CompanyAssistantProvisioningDenied, CompanyAssistantToolsConflict, CompanyAssistantToolsUnavailable } from "./company-assistant.errors";

/**
 * Creates the operator routes for company assistant setup and exact tool assignment.
 *
 * Called by: application routing at `/api/v1/organization/company-assistant`.
 * The domain authority checks current administrator and selected-resource permissions and owns persistence.
 * @see PrismaCompanyAssistantProvisioningUnitOfWork for publication and history retry ordering.
 */
export function _CreateCompanyAssistantProvisioningRouter(authority: CompanyAssistantProvisioningAuthority, resolveCaller: CompanyAssistantProvisioningCallerResolver, logger: Pick<Logger, "warn">): Router
{
	const router = Router();
	router.route("/tools").get(async function _GetTools(request, response)
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
			if (error instanceof CompanyAssistantProvisioningDenied)
				return void response.status(403).json({ error: "company_assistant_tools_denied" });
			if (error instanceof CompanyAssistantToolsUnavailable)
				return void response.status(404).json({ error: "company_assistant_unavailable" });
			logger.warn({ err: new Error("Company assistant tool selection read failed"), siloId: caller.siloId }, "Company assistant tools unavailable");
			response.status(503).json({ error: "company_assistant_tools_unavailable" });
		}
	}).put(async function _SetTools(request, response)
	{
		response.set("Cache-Control", "no-store");
		const caller = resolveCaller(request);
		if (caller === null)
			return void response.status(401).json({ error: "unauthorized" });
		const parsed = ___CompanyAssistantToolsSchema.safeParse(request.body);
		if (!parsed.success)
			return void response.status(400).json({ error: "invalid_request" });
		try
		{
			response.json(await authority.setTools(caller, parsed.data));
		}
		catch (error)
		{
			if (error instanceof CompanyAssistantProvisioningDenied)
				return void response.status(403).json({ error: "company_assistant_tools_denied" });
			if (error instanceof CompanyAssistantToolsConflict)
				return void response.status(409).json({ error: "company_assistant_revision_changed" });
			if (error instanceof CompanyAssistantToolsUnavailable)
				return void response.status(404).json({ error: "company_assistant_unavailable" });
			logger.warn({ err: new Error("Company assistant tool assignment failed"), siloId: caller.siloId }, "Company assistant tools unavailable");
			response.status(503).json({ error: "company_assistant_tools_unavailable" });
		}
	});
	router.post("/", async function _Provision(request, response)
	{
		response.set("Cache-Control", "no-store");
		const caller = resolveCaller(request);
		if (caller === null)
			return void response.status(401).json({ error: "unauthorized" });
		const parsed = ___CompanyAssistantProvisioningSchema.safeParse(request.body);
		if (!parsed.success)
			return void response.status(400).json({ error: "invalid_request" });
		try
		{
			const result = await authority.provision(caller, parsed.data);
			response.status(result.created ? 201 : 200).json({ created: result.created, assistant: { agentServiceId: result.agentServiceId, displayName: result.name } });
		}
		catch (error)
		{
			if (error instanceof CompanyAssistantProvisioningDenied)
				return void response.status(403).json({ error: "company_assistant_setup_denied" });
			logger.warn({ err: new Error("Company assistant setup dependency failed"), siloId: caller.siloId }, "Company assistant setup unavailable");
			response.status(503).json({ error: "company_assistant_setup_unavailable" });
		}
	});
	return router;
}
