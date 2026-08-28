import type { PrismaClient } from "@prisma/client";

import type { OrgMembershipRepository, OrgMembershipRow } from "./org-membership.types";
import { PrismaOrgMembershipRepository } from "./prisma-org-membership-repository";

/**
 * Opens one read transaction for each current Owner/Admin membership projection.
 *
 * This keeps the repository on the exact transaction binding while browser authentication services
 * receive only the narrow {@link OrgMembershipRepository} port.
 *
 * Called by: production OIDC and Tier 3 `/auth/me` composition.
 */
export class PrismaOrgMembershipUnitOfWork implements OrgMembershipRepository
{
	private readonly prisma: PrismaClient;

	/**
	 * Stores the application client that opens each membership read transaction.
	 * @param prisma - Application client used only to open the membership read transaction.
	 */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/**
	 * Reads current active Owner/Admin rows inside one transaction.
	 *
	 * @param subject - Verified subject whose administration projection is requested.
	 * @returns Active administration rows, or an empty list when none remain.
	 * @throws When the database read or role validation fails.
	 */
	async findAdminMemberships(subject: string): Promise<readonly OrgMembershipRow[]>
	{
		return this.prisma.$transaction(async function _ReadMemberships(transaction)
		{
			return await new PrismaOrgMembershipRepository(transaction).findAdminMemberships(subject);
		});
	}
}
