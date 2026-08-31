import type { PrismaClient } from "@prisma/client";

import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import { _ClaimStandaloneFirstUserOwner, PrismaStandaloneFirstUserAdmissionRepository } from "./prisma-standalone-first-user-admission-repository";
import { type StandaloneFirstUserAdmissionAuditPort, type StandaloneFirstUserAdmissionResult, type StandaloneFirstUserAdmissionUnitOfWork, type StandaloneFirstUserOwnerClaim } from "./standalone-first-user-admission.types";

/**
 * Opens the serializable transaction for a first-owner claim and retries a lost race exactly once.
 *
 * Serializable isolation plus the unique constraint on the owner row means two simultaneous logins
 * cannot both create an owner: one fails with a unique violation (P2002) or a serialization failure
 * (P2034). The shared unit-of-work envelope runs two attempts on exactly those codes, and one retry
 * is enough, because the slot is now filled — the second attempt reads it and returns
 * `AlreadyOwner` or `AlreadyClaimed` instead of racing again.
 *
 * Called by: OidcAuthService.onLoginEstablished in this package, composed with the audit appender
 * from apps/opencrane/src/app/public-app.ts.
 * @implements StandaloneFirstUserAdmissionUnitOfWork
 */
export class PrismaStandaloneFirstUserAdmissionUnitOfWork implements StandaloneFirstUserAdmissionUnitOfWork
{
	/** Root product-authority database client that can open the required transaction. */
	private readonly prisma: PrismaClient;
	/** Audit authority composed outside identity and invoked inside the selected transaction. */
	private readonly audit: StandaloneFirstUserAdmissionAuditPort;

	/**
	 * @param prisma - Full client, used only to open serializable owner-claim transactions.
	 * @param audit - Audit appender invoked inside each of those transactions.
	 */
	constructor(prisma: PrismaClient, audit: StandaloneFirstUserAdmissionAuditPort)
	{
		this.prisma = prisma;
		this.audit = audit;
	}

	/** @inheritdoc */
	async claimOwner(claim: StandaloneFirstUserOwnerClaim): Promise<StandaloneFirstUserAdmissionResult>
	{
		const audit = this.audit;
		return ___RunInPrismaUnitOfWork(this.prisma, async function _ClaimOwner(transaction): Promise<StandaloneFirstUserAdmissionResult>
		{
			return _ClaimStandaloneFirstUserOwner(new PrismaStandaloneFirstUserAdmissionRepository(transaction, audit), claim);
		}, { isolationLevel: "Serializable", operation: "standalone first-user admission", attemptLimit: 2 });
	}
}
