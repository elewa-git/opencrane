import { _CreateSelfRunStatusRouter } from "@opencrane/backend/agents/execution/runs";
import { _CreatePersonalConfigurationRouter } from "@opencrane/backend/agents/personal/configuration";
import { _CreatePersonaAgentRevisionSelectionFactory, _CreatePersonaOnboardingRouter } from "@opencrane/backend/agents/personal/personas";
import { _CreatePersonalAgentToolsComposition } from "@opencrane/backend/server/agents/agent-services";
import { _CreatePersonalArtifactCatalogueRouter } from "@opencrane/backend/server/agents/artifacts";
import { _CreateUserOnboardingComposition, _ResolveUserOnboardingOwner } from "@opencrane/backend/server/agents/onboarding";

import { _log } from "../../process/log";
import type { ProductRouteDependencies, RouteMount } from "../routes.types";

/**
 * Build the signed-in person's own setup routes: onboarding, persona, configuration, tools, files and runs.
 *
 * Onboarding is built once here because the persona routes continue the same interview workflow.
 *
 * Called by: `_RegisterRoutes` in routes.ts.
 *
 * @param dependencies - Shared product services; this area uses the computer profile name.
 * @returns The area's routes in mount order.
 */
export function _CreatePersonalWorkspaceRoutes(dependencies: ProductRouteDependencies): readonly RouteMount[]
{
	const { prisma } = dependencies;
	const { profileName } = dependencies.conversations.sandboxProfile;
	const onboarding = _CreateUserOnboardingComposition(prisma, _log, _ResolveUserOnboardingOwner, profileName, [profileName]);
	return [
		{ method: "use", path: "/api/v1/me/onboarding", handler: onboarding.router },
		{ method: "use", path: "/api/v1/me/assets", handler: _CreatePersonalArtifactCatalogueRouter(prisma, _log) },
		{ method: "use", path: "/api/v1/me/persona", handler: _CreatePersonaOnboardingRouter(prisma, _log, onboarding.personaWorkflow, _CreatePersonaAgentRevisionSelectionFactory()) },
		{ method: "use", path: "/api/v1/me/configuration", handler: _CreatePersonalConfigurationRouter(prisma, _log) },
		{ method: "use", path: "/api/v1/me/agent/tools", handler: _CreatePersonalAgentToolsComposition(prisma, _log) },
		{ method: "use", path: "/api/v1/me/runs", handler: _CreateSelfRunStatusRouter(prisma, _log) },
	];
}
