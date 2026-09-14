import { readFileSync } from "node:fs";

import type { Logger } from "pino";

import { __CreateStandaloneFirstUserAdmissionAuditAppender } from "@opencrane/backend/server/iam/audit-writer";
import { _AdmitDevelopmentIdentity, PrismaAuthenticatedPrincipalAdmissionUnitOfWork, PrismaAuthenticatedPrincipalCapabilityUnitOfWork } from "@opencrane/backend/server/iam/identity";

import { _CreateDevelopmentAuthentication } from "../development/authentication";
import type { DevelopmentIdentity } from "../development/config.types";
import type { K3dDevelopmentAuthenticationConfig } from "./config.types";
import type { PublicAuthenticationComposition } from "./public-app.types";

/**
 * Composes the local k3d session after current IAM admits its deployment-selected identity.
 *
 * The credential is accepted only as a 32-byte base64url proof, and every protected request still
 * resolves the durable Principal and current capabilities through the production authorities.
 * Called by: the production application root only when the Helm profile selects k3d development.
 * @returns Authentication middleware and routes bound to the configured HTTPS ingress host.
 * @throws When identity admission or the mounted credential contract fails.
 */
export async function _CreateK3dDevelopmentAuthentication(prisma: Parameters<typeof _AdmitDevelopmentIdentity>[0], config: K3dDevelopmentAuthenticationConfig, log: Logger): Promise<PublicAuthenticationComposition>
{
	const principal = await _AdmitDevelopmentIdentity(prisma, config.identity, __CreateStandaloneFirstUserAdmissionAuditAppender(), log);
	const credential = readFileSync(config.credentialPath, "utf8").trim();
	if (!/^[A-Za-z0-9_-]{43}$/u.test(credential))
		throw new Error("k3d development credential must contain one 32-byte base64url proof");
	const identity: DevelopmentIdentity = { displayName: config.identity.displayName, email: config.identity.email, issuer: config.identity.issuer, principalId: principal.principalId, siloId: config.identity.siloId, subjectId: config.identity.subject };
	const capabilities = new PrismaAuthenticatedPrincipalCapabilityUnitOfWork(prisma, log);
	const admission = new PrismaAuthenticatedPrincipalAdmissionUnitOfWork(prisma, log);
	const transport = { browserHost: config.publicHost, directHost: config.publicHost, proxyTargets: new Set([config.publicHost]), scheme: "https" as const };
	return _CreateDevelopmentAuthentication(identity, capabilities, admission, credential, log, transport);
}
