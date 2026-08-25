import type { Prisma, PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

import type { AuthenticatedPrincipalAdmission, AuthenticatedPrincipalAdmissionInput, AuthenticatedRequestPrincipal } from "@opencrane/backend/server/infra/auth";

import { PrismaAuthenticatedPrincipalDirectoryRepository } from "./prisma-authenticated-principal-directory";

/** Reconciles verified group claims and resolves their exact Principal in one transaction. */
export class PrismaAuthenticatedPrincipalAdmissionUnitOfWork implements AuthenticatedPrincipalAdmission
{
	/** Root product client used only to open the identity admission transaction. */
	private readonly prisma: PrismaClient;
	/** Identity-scoped logger used when durable Principal resolution fails. */
	private readonly log: Logger;

	/** Store the product authority and identity logger composed by the application. */
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
		if (!siloId || !issuer || !subject) return null;
		try
		{
			const principal = await this.prisma.$transaction(async function _Resolve(transaction: Prisma.TransactionClient)
			{
				const repository = new PrismaAuthenticatedPrincipalDirectoryRepository(transaction);
				return repository.resolveAuthenticatedPrincipal(siloId, issuer, subject);
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
