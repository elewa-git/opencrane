import type { Logger } from "pino";

import type { AuthenticatedPrincipal } from "./authenticated-principals/authenticated-principal-directory.types";
import { PrismaAuthenticatedPrincipalDirectoryUnitOfWork } from "./authenticated-principals/prisma-authenticated-principal-directory-unit-of-work";
import { PrismaGroupClaimProjectionUnitOfWork } from "./group-claims/mirror-groups";
import { PrismaStandaloneFirstUserAdmissionUnitOfWork } from "./standalone-first-user/prisma-standalone-first-user-admission-unit-of-work";
import { StandaloneFirstUserAdmissionOutcomes, type StandaloneFirstUserAdmissionAuditPort } from "./standalone-first-user/standalone-first-user-admission.types";
import type { DevelopmentIdentityAdmission } from "./development-identity-admission.types";

/**
 * Reconcile one deployment-selected development Principal and claim an empty standalone owner slot.
 *
 * Called by: the OpenCrane k3d development composition before it opens the public listener.
 * @returns The durable Principal resolved from the current identity directory.
 */
export async function _AdmitDevelopmentIdentity(prisma: ConstructorParameters<typeof PrismaGroupClaimProjectionUnitOfWork>[0], identity: DevelopmentIdentityAdmission, audit: StandaloneFirstUserAdmissionAuditPort, log: Logger): Promise<AuthenticatedPrincipal>
{
	const command = { siloId: identity.siloId, issuer: identity.issuer, subject: identity.subject, email: identity.email, displayName: identity.displayName, groups: [], log };
	const projection = new PrismaGroupClaimProjectionUnitOfWork(prisma);
	await projection.reconcile(command);
	const ownerAdmission = new PrismaStandaloneFirstUserAdmissionUnitOfWork(prisma, audit);
	const owner = await ownerAdmission.claimOwner({ clusterTenant: identity.siloId, subject: identity.subject, mayCreateOwner: true });
	if (owner.outcome !== StandaloneFirstUserAdmissionOutcomes.Admitted && owner.outcome !== StandaloneFirstUserAdmissionOutcomes.AlreadyOwner)
	{
		throw new Error(`development identity owner admission failed: ${owner.outcome}`);
	}
	const directory = new PrismaAuthenticatedPrincipalDirectoryUnitOfWork(prisma);
	const principal = await directory.resolveAuthenticatedPrincipal(identity.siloId, identity.issuer, identity.subject);
	if (principal === null)
		throw new Error("development identity Principal is unavailable after reconciliation");
	return principal;
}
