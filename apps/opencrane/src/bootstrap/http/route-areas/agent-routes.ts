import { _CreateCompanyAssistantComposition } from "@opencrane/backend/server/agents/agent-services";
import { __CreateSkillAuthoringValidationSubmissionRouter, _CreateSkillCatalogueRouter, _ResolveSkillAuthoringValidationCaller, PrismaSkillAuthoringValidationSubmissionUnitOfWork } from "@opencrane/backend/server/agents/skills";

import { _log } from "../../process/log";
import type { ProductRouteDependencies, RouteMount } from "../routes.types";

/**
 * Build the company-assistant and skill routes.
 *
 * Both skill routers share `/api/v1/skills`; the catalogue mounts before authoring validation.
 *
 * Called by: `_RegisterRoutes` in routes.ts.
 *
 * @param dependencies - Shared product services; this area uses history, the computer profile and the workflow engine.
 * @returns The area's routes in mount order.
 */
export function _CreateAgentRoutes(dependencies: ProductRouteDependencies): readonly RouteMount[]
{
	const { prisma, conversations, tools } = dependencies;
	return [
		{ method: "use", path: "/api/v1/organization/company-assistant", handler: _CreateCompanyAssistantComposition(prisma, conversations.history, conversations.sandboxProfile, _log) },
		{ method: "use", path: "/api/v1/skills", handler: _CreateSkillCatalogueRouter(prisma, _log) },
		{ method: "use", path: "/api/v1/skills", handler: __CreateSkillAuthoringValidationSubmissionRouter({ resolveCaller: _ResolveSkillAuthoringValidationCaller, authority: new PrismaSkillAuthoringValidationSubmissionUnitOfWork(prisma, tools.workflows.execution), logger: _log }) },
	];
}
