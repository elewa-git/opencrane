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
	/** Reads the current assignment after checking the administrator's current permission. */
	getTools(caller: CompanyAssistantProvisioningCaller): Promise<CompanyAssistantToolsSelection>;
	/** Publishes a successor only when the caller still names the active source revision. */
	setTools(caller: CompanyAssistantProvisioningCaller, command: CompanyAssistantToolsCommand): Promise<CompanyAssistantToolsSelection>;
}

/** Publishes PostgreSQL authority in an existing transaction without performing external history writes. */
export interface CompanyAssistantProvisioningRepository
{
	provision(caller: CompanyAssistantProvisioningCaller, command: CompanyAssistantProvisioningCommand, now: Date): Promise<CompanyAssistantProvisioningResult>;
	/** Reads a current assignment without recording an effect admission. */
	getTools(caller: CompanyAssistantProvisioningCaller, now: Date): Promise<CompanyAssistantToolsSelection>;
	/** Records assignment authority and publishes the revision and grants in this transaction. */
	setTools(caller: CompanyAssistantProvisioningCaller, command: CompanyAssistantToolsCommand, now: Date): Promise<CompanyAssistantToolsSelection>;
}

/** Replaces the company's complete tool selection against one observed active revision. */
export interface CompanyAssistantToolsCommand
{
	/** Names the active revision observed by GET; stale requests must refresh before another edit. */
	readonly expectedActiveRevisionId: string;
	/** Names at most 32 unique immutable tool revisions; an empty list removes every assignment. */
	readonly toolRevisionIds: readonly string[];
}

/** Returns the authoritative current selection without credentials or private execution coordinates. */
export interface CompanyAssistantToolsSelection
{
	/** Identifies the silo's stable company assistant. */
	readonly agentServiceId: string;
	/** Identifies the immutable revision that owns this selection. */
	readonly activeRevisionId: string;
	/** Lists exact selected tool revisions in canonical order. */
	readonly toolRevisionIds: readonly string[];
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
