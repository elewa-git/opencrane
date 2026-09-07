import { Prisma, type PrismaClient } from "@prisma/client";
import type { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";

import { __EnsureCompanyAssistantIdentity } from "../company-assistant-identity";
import type { CompanyAssistantProvisioningAuthority, CompanyAssistantProvisioningCaller, CompanyAssistantProvisioningCommand, CompanyAssistantProvisioningPolicy, CompanyAssistantProvisioningResult } from "../company-assistant-provisioning.types";
import { PrismaCompanyAssistantProvisioningRepository } from "./prisma-company-assistant-provisioning";

/**
 * Retries PostgreSQL creation races and establishes Kurrent identity only after a successful commit.
 *
 * Called by: the administrator setup router through CompanyAssistantProvisioningAuthority.
 * A later HTTP retry resumes a failed identity append from the same durable service and first revision.
 * @see __EnsureCompanyAssistantIdentity for active-state preservation on retries.
 */
export class PrismaCompanyAssistantProvisioningUnitOfWork implements CompanyAssistantProvisioningAuthority
{
	/** Receives application-owned database, execution policy and checked history dependencies. */
	public constructor(private readonly prisma: PrismaClient, private readonly policy: CompanyAssistantProvisioningPolicy, private readonly identities: Pick<AgentIdentityHistory, "load" | "append" | "loadActive">) {}

	/** Publishes once and returns only after the committed company identity is active. */
	public async provision(caller: CompanyAssistantProvisioningCaller, command: CompanyAssistantProvisioningCommand): Promise<CompanyAssistantProvisioningResult>
	{
		let result: CompanyAssistantProvisioningResult | null = null;
		const policy = this.policy;
		for (let attempt = 0; attempt < 3; attempt += 1)
		{
			try
			{
				result = await this.prisma.$transaction(async function _Provision(transaction: Prisma.TransactionClient)
				{
					return new PrismaCompanyAssistantProvisioningRepository(transaction, policy).provision(caller, command, new Date());
				}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
				break;
			}
			catch (error)
			{
				if (attempt === 2 || !(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2002", "P2034"].includes(error.code))
					throw error;
			}
		}
		if (result === null)
			throw new Error("Company assistant provisioning did not commit");
		await __EnsureCompanyAssistantIdentity(this.identities, result);
		return result;
	}
}
