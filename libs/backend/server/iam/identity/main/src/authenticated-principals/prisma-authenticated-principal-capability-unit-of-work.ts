import type { Prisma, PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

import type { AuthenticatedPrincipalAdmissionInput } from "@opencrane/backend/server/infra/auth";
import { PrismaAuthorizationAuthority, PrismaOrganizationAdminGrantBootstrapRepository, PrismaOrganizationMemberProductGrantBootstrapRepository } from "@opencrane/backend/server/iam/authorization";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import type { AuthenticatedPrincipalCapabilityAuthorizationFactory, AuthenticatedPrincipalCapabilityReader } from "./authenticated-principal-capability.types";
import { PrismaAuthenticatedPrincipalDirectoryRepository } from "./prisma-authenticated-principal-directory";

/** Reads current human product capabilities through the central authority in one transaction. */
export class PrismaAuthenticatedPrincipalCapabilityUnitOfWork implements AuthenticatedPrincipalCapabilityReader
{
	/** Root product client that opens the status-read transaction. */
	private readonly prisma: PrismaClient;
	/** Identity logger used when capability projection fails. */
	private readonly log: Logger;
	/** Builds central authorization over the same transaction. */
	private readonly createAuthorization: AuthenticatedPrincipalCapabilityAuthorizationFactory<Prisma.TransactionClient> | undefined;

	/**
	 * Stores the product client, logger, and optional focused-test authority factory.
	 * @param prisma - Root product client that opens the status-read transaction.
	 * @param log - Identity logger used when projection fails.
	 * @param createAuthorization - Optional focused-test factory; production binds Prisma authorization.
	 */
	constructor(prisma: PrismaClient, log: Logger, createAuthorization?: AuthenticatedPrincipalCapabilityAuthorizationFactory<Prisma.TransactionClient>)
	{
		this.prisma = prisma;
		this.log = log;
		this.createAuthorization = createAuthorization;
	}

	/**
	 * Resolves the Principal, refreshes membership-managed grants, and reads `organization:administer`.
	 *
	 * `/auth/me` uses this projection to guide the browser without turning an identity-provider role
	 * claim into product authorization. Product routes still repeat admission in their write transaction.
	 *
	 * Called by: `OidcAuthService.enrichStatusUser`.
	 * @param input - Silo, issuer, and subject derived from the verified session and request host.
	 * @returns True when the current central grant set allows organisation administration.
	 * @throws When Principal, membership, grant, or authorization persistence is unavailable.
	 */
	async canAdministerOrganization(input: AuthenticatedPrincipalAdmissionInput): Promise<boolean>
	{
		const siloId = input.siloId.trim();
		const issuer = input.issuer.trim();
		const subject = input.subject.trim();
		if (!siloId || !issuer || !subject)
		{
			return false;
		}
		try
		{
			const createAuthorization = this.createAuthorization;
			return await this.prisma.$transaction(async function _ReadCapability(transaction: Prisma.TransactionClient)
			{
				// 1. Resolve the stored Principal so the status response cannot rely on session role claims.
				const repository = new PrismaAuthenticatedPrincipalDirectoryRepository(transaction);
				const principal = await repository.resolveAuthenticatedPrincipal(siloId, issuer, subject);
				if (principal === null)
				{
					return false;
				}

				// 2. Reconcile membership-managed grants so role and suspension changes affect this read now.
				const now = new Date();
				const bootstrap = new PrismaOrganizationAdminGrantBootstrapRepository(transaction);
				await bootstrap.reconcileOrganizationAdminGrant({ siloId, subject, principalId: principal.principalId, now });
				const productBootstrap = new PrismaOrganizationMemberProductGrantBootstrapRepository(transaction);
				await productBootstrap.reconcileOrganizationMemberProductGrants({ siloId, subject, principalId: principal.principalId, now });

				// 3. Project the current central decision as a UI hint; product routes still re-admit writes.
				const authorization = createAuthorization === undefined ? new PrismaAuthorizationAuthority(transaction) : createAuthorization(transaction);
				const resources = [{ kind: ProductAuthorizationResourceKinds.Organization, id: siloId }] as const;
				const allowed = await authorization.listPrincipalEntitled({ siloId, principalId: principal.principalId, action: ProductAuthorizationActions.Administer, resources, nowEpochMs: now.getTime() });
				return allowed.length === 1;
			});
		}
		catch (err)
		{
			this.log.error({ err, siloId, subject }, "organization administration capability projection failed");
			throw err;
		}
	}
}
