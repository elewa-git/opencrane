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
 * profile contracts used by production. This adapter replaces only browser authentication; it
 * retains the production route, run-admission, conversation-history, and output authorities.
 *
 * Called by: the Tier 2 process composition after it starts the dependencies supplied through
 * `DevelopmentPublicAppDependencies`.
 */
export function _CreateDevelopmentPublicApp(dependencies: DevelopmentPublicAppDependencies)
{
	const principalAdmission = new PrismaAuthenticatedPrincipalAdmissionUnitOfWork(dependencies.prisma, _log);
	const principalCapabilities = new PrismaAuthenticatedPrincipalCapabilityUnitOfWork(dependencies.prisma, _log);
	const browserOrigin = new URL(dependencies.browserOrigin);
	const transport = {
		browserHost: browserOrigin.host,
		browserScheme: browserOrigin.protocol === "https:" ? "https" as const : "http" as const,
		directHost: "local-development.localhost:8080",
		proxyTargets: new Set(["127.0.0.1:8080", "localhost:8080"]),
		scheme: "http" as const,
	};
	const authentication = _CreateDevelopmentAuthentication(_DEVELOPMENT_IDENTITY, principalCapabilities, principalAdmission, dependencies.browserSessionCredential, _log, transport);
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
