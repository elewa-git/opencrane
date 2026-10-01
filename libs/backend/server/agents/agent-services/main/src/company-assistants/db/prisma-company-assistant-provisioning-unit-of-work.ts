import type { PrismaClient } from "@prisma/client";
import type { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";
import { ___RunInPrismaUnitOfWork, type PrismaUnitOfWorkIsolationLevel } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import { __EnsureCompanyAssistantIdentity } from "../company-assistant-identity";
import type { CompanyAssistantProvisioningAuthority, CompanyAssistantProvisioningCaller, CompanyAssistantProvisioningCommand, CompanyAssistantProvisioningPolicy, CompanyAssistantProvisioningRepository, CompanyAssistantProvisioningResult, CompanyAssistantToolsCommand, CompanyAssistantToolsSelection } from "../company-assistant-provisioning.types";
import { PrismaCompanyAssistantProvisioningRepository } from "./prisma-company-assistant-provisioning";

/**
 * Commits company setup or tool edits and establishes identity only after the setup transaction.
 *
 * Called by: the public company assistant router. Proven rollback conflicts receive at most three
 * fresh transactions; uncertain outcomes are returned to the caller without replaying a write.
 * @see __EnsureCompanyAssistantIdentity for active-state preservation on setup retries.
 */
export class PrismaCompanyAssistantProvisioningUnitOfWork implements CompanyAssistantProvisioningAuthority
{
	/** Receives application-owned database, execution policy and checked history dependencies. */
	public constructor(private readonly prisma: PrismaClient, private readonly policy: CompanyAssistantProvisioningPolicy, private readonly identities: Pick<AgentIdentityHistory, "load" | "append" | "loadActive">) {}

	/** Reads the current authorized selection without touching the stable identity history. */
	public getTools(caller: CompanyAssistantProvisioningCaller): Promise<CompanyAssistantToolsSelection>
	{
		return this._WithRepository(repository => repository.getTools(caller, new Date()), "ReadCommitted", 1);
	}

	/** Repeats only proven full rollbacks; an uncertain commit must be resolved through a fresh GET. */
	public setTools(caller: CompanyAssistantProvisioningCaller, command: CompanyAssistantToolsCommand): Promise<CompanyAssistantToolsSelection>
	{
		return this._WithRepository(repository => repository.setTools(caller, command, new Date()), "Serializable", 3);
	}

	/** Publishes once and returns only after the committed company identity is active. */
	public async provision(caller: CompanyAssistantProvisioningCaller, command: CompanyAssistantProvisioningCommand): Promise<CompanyAssistantProvisioningResult>
	{
		const result = await this._WithRepository(repository => repository.provision(caller, command, new Date()), "Serializable", 3);
		await __EnsureCompanyAssistantIdentity(this.identities, result);
		return result;
	}

	/** Binds each complete operation to one fresh transaction and the shared proven-rollback policy. */
	private _WithRepository<Result>(operation: (repository: CompanyAssistantProvisioningRepository) => Promise<Result>, isolationLevel: PrismaUnitOfWorkIsolationLevel, attemptLimit: number): Promise<Result>
	{
		const policy = this.policy;
		return ___RunInPrismaUnitOfWork(this.prisma, async function _Run(transaction)
		{
			const repository = new PrismaCompanyAssistantProvisioningRepository(transaction, policy);
			return operation(repository);
		}, { isolationLevel, attemptLimit, operation: "company assistant" });
	}
}
