import { PrismaAuthenticatedPrincipalAdmissionUnitOfWork, PrismaAuthenticatedPrincipalCapabilityUnitOfWork } from "@opencrane/backend/server/iam/identity";

import { _CreatePublicApp } from "../app/public-app";
import { _log } from "../app/log";
import { _CreateDevelopmentAuthentication } from "./authentication";
import { _DEVELOPMENT_IDENTITY } from "./config";
import type { DevelopmentPublicAppDependencies } from "./public-app.types";

/**
 * Compose the current authenticated product routes with the development-only browser boundary.
 *
 * The caller must provide the same current HistoryStore, workflows, model/provider effects, and
 * profile contracts used by production. This seam changes only browser identity establishment; it
 * does not replace product route authority, run admission, conversation history, or output paths.
 *
 * Called by: the Tier 2 process composition after it starts its exact owned dependencies.
 */
export function _CreateDevelopmentPublicApp(dependencies: DevelopmentPublicAppDependencies)
{
	const principalAdmission = new PrismaAuthenticatedPrincipalAdmissionUnitOfWork(dependencies.prisma, _log);
	const principalCapabilities = new PrismaAuthenticatedPrincipalCapabilityUnitOfWork(dependencies.prisma, _log);
	const authentication = _CreateDevelopmentAuthentication(_DEVELOPMENT_IDENTITY, principalCapabilities, principalAdmission, dependencies.browserSessionCredential, _log);
	return _CreatePublicApp(
		dependencies.prisma,
		authentication,
		dependencies.artifactScannerEnabled,
		dependencies.health,
		dependencies.mcpWorkflows,
		null,
		dependencies.providerEffects,
		dependencies.historyStore,
		dependencies.conversationPrivatePayloadKeyringPath,
		dependencies.profile,
		dependencies.organizationMembers,
	);
}
