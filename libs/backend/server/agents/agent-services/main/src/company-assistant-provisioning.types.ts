import type { AgentBudget } from "@opencrane/models/agents";
import type { Request } from "express";

/** Identifies the authenticated administrator using only server-resolved coordinates. */
export interface CompanyAssistantProvisioningCaller
{
	readonly siloId: string;
	readonly principalId: string;
}

/** Resolves the current authenticated administrator without accepting identity fields from the body. */
export type CompanyAssistantProvisioningCallerResolver = (request: Request) => CompanyAssistantProvisioningCaller | null;

/** Owns the durable publication and checked identity establishment behind the public setup route. */
export interface CompanyAssistantProvisioningAuthority
{
	provision(caller: CompanyAssistantProvisioningCaller, command: CompanyAssistantProvisioningCommand): Promise<CompanyAssistantProvisioningResult>;
}

/** Publishes PostgreSQL authority in an existing transaction without performing external history writes. */
export interface CompanyAssistantProvisioningRepository
{
	provision(caller: CompanyAssistantProvisioningCaller, command: CompanyAssistantProvisioningCommand, now: Date): Promise<CompanyAssistantProvisioningResult>;
}

/** Carries the explicit administrator choices for the silo's first company assistant. */
export interface CompanyAssistantProvisioningCommand
{
	readonly name: string;
	readonly modelDefinitionId: string;
	readonly invokerPrincipalIds: readonly string[];
}

/** Supplies the reviewed deployment policy rather than allowing browser-selected execution limits. */
export interface CompanyAssistantProvisioningPolicy
{
	readonly workloadProfile: string;
	readonly promptPolicyVersion: string;
	readonly budget: AgentBudget;
}

/** Carries committed creation facts needed to establish the stable managed identity after commit. */
export interface CompanyAssistantProvisioningResult
{
	/** Distinguishes accepted initial choices from an existing assistant that was left unchanged. */
	readonly created: boolean;
	readonly siloId: string;
	readonly agentServiceId: string;
	readonly agentRevisionId: string;
	readonly principalId: string;
	readonly agentIdentityId: string;
	readonly name: string;
	readonly createdAt: string;
	readonly createdByPrincipalId: string;
	/** Reuses the persisted first revision UUID for an idempotent identity genesis append. */
	readonly identityEventId: string;
}
