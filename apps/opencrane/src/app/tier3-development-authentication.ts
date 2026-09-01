import type { PrismaClient } from "@prisma/client";

import { __CreateStandaloneFirstUserAdmissionAuditAppender } from "@opencrane/backend/server/iam/audit-writer";
import { PrismaAuthenticatedPrincipalAdmissionUnitOfWork, PrismaAuthenticatedPrincipalCapabilityUnitOfWork, Tier3DevelopmentAuthService, ___Tier3DevelopmentAuthRouter } from "@opencrane/backend/server/iam/identity";
import { ___CreateBrowserSessionMiddleware, ___DevelopmentAuthMiddleware, PrismaOwnedOrgSummaryRepository } from "@opencrane/backend/server/infra/auth";

import type { OpenCraneTier3DevelopmentAuthenticationConfig } from "./config.types";
import { _log } from "./log";
import type { PublicAuthenticationComposition } from "./public-app.types";

/**
 * Builds the disposable Tier 3 proxy-proof login without changing the production OIDC branch.
 *
 * Called by: the OpenCrane composition root only when startup selected `tier3-development`.
 * @param prisma - Durable Principal, owner-membership, and audit authority.
 * @param config - Fixed identity, proof, host, lifetime, and independent session secret.
 * @returns The public authentication composition shared by HTTP, internal delegation, and sockets.
 */
export function _CreateTier3DevelopmentAuthentication(prisma: PrismaClient, config: OpenCraneTier3DevelopmentAuthenticationConfig): PublicAuthenticationComposition
{
	const authority = { issuer: config.issuer, siloId: config.siloId, subject: config.subject };
	const admission = new PrismaAuthenticatedPrincipalAdmissionUnitOfWork(prisma, _log);
	const authMiddleware = ___DevelopmentAuthMiddleware(admission, authority, config.expectedHost, _log);
	const summaries = new PrismaOwnedOrgSummaryRepository(prisma);
	const capabilities = new PrismaAuthenticatedPrincipalCapabilityUnitOfWork(prisma, _log);
	const authService = new Tier3DevelopmentAuthService(config, prisma, summaries, __CreateStandaloneFirstUserAdmissionAuditAppender(), _log, capabilities);
	return {
		authMiddleware,
		router: ___Tier3DevelopmentAuthRouter(authService),
		sessionMiddleware: ___CreateBrowserSessionMiddleware({
			cookieName: "opencrane_tier3",
			cookieSecure: true,
			sessionMaxAgeMs: config.sessionMaxAgeMilliseconds,
			sessionSecret: config.sessionSecret,
		}),
	};
}
