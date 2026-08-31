import type { Prisma, PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

import type { AuthenticatedPrincipalAdmission, AuthenticatedPrincipalAdmissionInput, AuthenticatedRequestPrincipal } from "@opencrane/backend/server/infra/auth";
import { PrismaOrganizationAdminGrantBootstrapRepository, PrismaOrganizationMemberProductGrantBootstrapRepository } from "@opencrane/backend/server/iam/authorization";

import { PrismaAuthenticatedPrincipalDirectoryRepository } from "./prisma-authenticated-principal-directory";

/** Reconciles verified group claims and resolves their exact Principal in one transaction. */
export class PrismaAuthenticatedPrincipalAdmissionUnitOfWork implements AuthenticatedPrincipalAdmission
{
	/** Root product client used only to open the identity admission transaction. */
	private readonly prisma: PrismaClient;
	/** Identity-scoped logger used when durable Principal resolution fails. */
	private readonly log: Logger;

	/**
	 * Stores the product authority and identity logger composed by the application.
	 * @param prisma - Root product client that opens identity transactions.
	 * @param log - Identity logger used when projection fails.
	 */
	constructor(prisma: PrismaClient, log: Logger)
	{
		this.prisma = prisma;
		this.log = log;
	}

	/** @inheritdoc */
	async admit(input: AuthenticatedPrincipalAdmissionInput): Promise<AuthenticatedRequestPrincipal | null>
	{
		const siloId = input.siloId.trim();
		const issuer = input.issuer.trim();
		const subject = input.subject.trim();
		if (!siloId || !issuer || !subject)
		{
			return null;
		}
		try
		{
			const principal = await this.prisma.$transaction(async function _Resolve(transaction: Prisma.TransactionClient)
			{
				// 1. Resolve the Principal from the verified issuer and subject before projecting any grant.
				const repository = new PrismaAuthenticatedPrincipalDirectoryRepository(transaction);
				const resolvedPrincipal = await repository.resolveAuthenticatedPrincipal(siloId, issuer, subject);
				if (resolvedPrincipal === null)
				{
					return null;
				}

				// 2. Project the current membership role into a managed grant in the same transaction.
				const bootstrap = new PrismaOrganizationAdminGrantBootstrapRepository(transaction);
				await bootstrap.reconcileOrganizationAdminGrant({ siloId, subject, principalId: resolvedPrincipal.principalId, now: new Date() });
				const productBootstrap = new PrismaOrganizationMemberProductGrantBootstrapRepository(transaction);
				await productBootstrap.reconcileOrganizationMemberProductGrants({ siloId, subject, principalId: resolvedPrincipal.principalId, now: new Date() });
				return resolvedPrincipal;
			});
			return principal === null ? null : { ...principal, issuer, subject };
		}
		catch (err)
		{
			this.log.error({ err, siloId, subject }, "authenticated Principal projection failed");
			throw err;
		}
	}
}
