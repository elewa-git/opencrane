import { Router } from "express";
import type { Logger } from "@opencrane/backend/observability";

import type { CompanyAssistantProvisioningAuthority, CompanyAssistantProvisioningCallerResolver } from "./company-assistant-provisioning.types";
import { ___CompanyAssistantProvisioningSchema } from "./company-assistant-provisioning.validator";
import { CompanyAssistantProvisioningDenied } from "./db/prisma-company-assistant-provisioning";

/**
 * Creates the explicit operator setup route for the company's first shared assistant.
 *
 * Called by: application routing at `/api/v1/organization/company-assistant`.
 * The domain authority checks administrator and model permission and owns all persistence.
 * @see PrismaCompanyAssistantProvisioningUnitOfWork for publication and history retry ordering.
 */
export function _CreateCompanyAssistantProvisioningRouter(authority: CompanyAssistantProvisioningAuthority, resolveCaller: CompanyAssistantProvisioningCallerResolver, logger: Pick<Logger, "warn">): Router
{
	const router = Router();
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
