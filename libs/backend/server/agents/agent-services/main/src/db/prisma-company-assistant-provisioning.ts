import { randomUUID } from "node:crypto";
import { AgentRevisionState, AgentServiceKind, AgentServiceState, McpApprovalStatus, McpServerRevisionState, McpServerStatus, OrgMemberStatus, PrincipalProvenance, type Prisma } from "@prisma/client";
import { PrismaAuthorizationAuthority, PrismaManagedAuthorizationGrantRepository, type AuthorizationAuthority, type ManagedAuthorizationGrantRepository, type ManagedAuthorizationGrantSpec } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationDecisionOutcomes, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability, type ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";

import type { CompanyAssistantProvisioningCaller, CompanyAssistantProvisioningCommand, CompanyAssistantProvisioningPolicy, CompanyAssistantProvisioningRepository, CompanyAssistantProvisioningResult, CompanyAssistantToolsCommand, CompanyAssistantToolsSelection } from "../company-assistant-provisioning.types";
import { ___CompanyAssistantToolsSchema } from "../company-assistant-provisioning.validator";
import { __CompanyAssistantServiceId, __ManagedAgentIdentityId } from "../managed-agent-identity";
import type { AgentRevisionWriterRepository } from "./prisma-agent-revision-writer.types";
import { _AGENT_REVISION_INCLUDE, _AgentRevisionContentFromRow, PrismaAgentRevisionWriterRepository } from "./prisma-agent-revision-writer";

/** Stops provisioning without exposing the administrator's grants or other members' identities. */
export class CompanyAssistantProvisioningDenied extends Error
{
	/** Supplies one rollback error for invalid choices or refused authority. */
	public constructor() { super("Company assistant provisioning was not authorized or available"); }
}

/** Requires a fresh selection read after the active revision changes. */
export class CompanyAssistantToolsConflict extends Error
{
	/** Rejects stale edits without suggesting that replacement choices were committed. */
	public constructor() { super("Company assistant active revision changed"); }
}

/** Conceals unavailable company service coordinates after administrator authorization. */
export class CompanyAssistantToolsUnavailable extends Error
{
	/** Reports that no active published company assistant can be edited. */
	public constructor() { super("Company assistant is unavailable"); }
}

/**
 * Publishes the silo's company assistant and its exact initial or replacement tool grants.
 *
 * Called by: the administrator setup composition, inside a Serializable transaction that retries
 * unique-create races. Setup retries leave existing choices unchanged; setTools owns explicit edits.
 * Kurrent identity establishment follows commit through __EnsureCompanyAssistantIdentity.
 * @see CompanyAssistantProvisioningCommand for the explicit administrator choices.
 */
export class PrismaCompanyAssistantProvisioningRepository implements CompanyAssistantProvisioningRepository
{
	private readonly authorization: AuthorizationAuthority;
	private readonly grants: ManagedAuthorizationGrantRepository;
	private readonly revisions: AgentRevisionWriterRepository;

	/** Binds all PostgreSQL writes and decisions to the same transaction. */
	public constructor(private readonly transaction: Prisma.TransactionClient, private readonly policy: CompanyAssistantProvisioningPolicy, authorization?: AuthorizationAuthority, grants?: ManagedAuthorizationGrantRepository)
	{
		this.authorization = authorization ?? new PrismaAuthorizationAuthority(this.transaction);
		this.grants = grants ?? new PrismaManagedAuthorizationGrantRepository(this.transaction);
		this.revisions = new PrismaAgentRevisionWriterRepository(this.transaction);
	}

	/** Reads current assignment eligibility without recording an effect admission or revealing credentials. */
	public async getTools(caller: CompanyAssistantProvisioningCaller, now: Date): Promise<CompanyAssistantToolsSelection>
	{
		const decision = await this.authorization.decidePrincipal({ ...caller, resource: { kind: ProductAuthorizationResourceKinds.Organization, id: caller.siloId }, action: ProductAuthorizationActions.Administer, nowEpochMs: now.getTime() });
		if (decision.outcome !== AuthorizationDecisionOutcomes.Allow)
			throw new CompanyAssistantProvisioningDenied();
		const service = await this._CurrentCompany(caller.siloId);
		return { agentServiceId: service.id, activeRevisionId: service.activeRevision.id, toolRevisionIds: service.activeRevision.mcpToolAssignments.map(assignment => assignment.toolRevisionId).sort() };
	}

	/**
	 * Publishes an immutable replacement and its exact own-principal grants in the caller's transaction.
	 * A stale expected revision always conflicts, including a retry after an uncertain successful commit.
	 * Current no-ops still require fresh Administer and selected-tool Assign admissions.
	 */
	public async setTools(caller: CompanyAssistantProvisioningCaller, command: CompanyAssistantToolsCommand, now: Date): Promise<CompanyAssistantToolsSelection>
	{
		if (!___CompanyAssistantToolsSchema.safeParse(command).success)
			throw new CompanyAssistantProvisioningDenied();
		const toolRevisionIds = [...command.toolRevisionIds].sort();
		const argumentsDigest = ___DigestCanonicalJson({ agentServiceId: __CompanyAssistantServiceId(caller.siloId), expectedActiveRevisionId: command.expectedActiveRevisionId, toolRevisionIds });
		await this._Admit(caller, { kind: ProductAuthorizationResourceKinds.Organization, id: caller.siloId }, ProductAuthorizationActions.Administer, argumentsDigest, now);
		const service = await this._CurrentCompany(caller.siloId);
		const source = service.activeRevision;
		if (source.id !== command.expectedActiveRevisionId)
			throw new CompanyAssistantToolsConflict();
		const tools = await this.transaction.mcpToolRevision.findMany({ where: { id: { in: toolRevisionIds }, siloId: caller.siloId, serverRevision: { is: { siloId: caller.siloId, state: McpServerRevisionState.Ready, server: { is: { siloId: caller.siloId, status: McpServerStatus.Active, approvalStatus: McpApprovalStatus.Published } } } } }, select: { id: true } });
		if (tools.length !== toolRevisionIds.length)
			throw new CompanyAssistantProvisioningDenied();
		for (const toolRevisionId of toolRevisionIds)
			await this._Admit(caller, { kind: ProductAuthorizationResourceKinds.McpToolRevision, id: toolRevisionId }, ProductAuthorizationActions.Assign, argumentsDigest, now);
		const previousToolIds = source.mcpToolAssignments.map(assignment => assignment.toolRevisionId).sort();
		if (previousToolIds.length === toolRevisionIds.length && previousToolIds.every((id, index) => id === toolRevisionIds[index]))
			return { agentServiceId: service.id, activeRevisionId: source.id, toolRevisionIds };
		const revisionId = randomUUID();
		await this.revisions.createDraft({ agentRevisionId: revisionId, siloId: caller.siloId, agentServiceId: service.id, revision: source.revision + 1, parentRevisionId: source.id, sourceRevisionId: null, content: { ..._AgentRevisionContentFromRow(source), mcpToolRevisionIds: toolRevisionIds }, changeMessage: "Administrator replaced company assistant tool assignments", authoredBy: caller.principalId, createdAt: now });
		for (const toolRevisionId of [...new Set([...previousToolIds, ...toolRevisionIds])].sort())
		{
			const resource = { kind: ProductAuthorizationResourceKinds.McpToolRevision, id: toolRevisionId };
			const grants = toolRevisionIds.includes(toolRevisionId) ? [ProductAuthorizationActions.Use, ProductAuthorizationActions.Invoke].map(action => _Grant(service.principalId, caller.principalId, resource, action)) : [];
			await this.grants.reconcileManagedResourceGrants({ siloId: caller.siloId, managerId: `company-assistant:${service.id}`, resource, now, grants });
		}
		await this.transaction.agentRevision.update({ where: { id_siloId: { id: revisionId, siloId: caller.siloId } }, data: { state: AgentRevisionState.Published, publishedAt: now } });
		const updated = await this.transaction.agentService.updateMany({ where: { id: service.id, siloId: caller.siloId, kind: AgentServiceKind.Managed, state: AgentServiceState.Active, activeRevisionId: source.id }, data: { activeRevisionId: revisionId, updatedAt: now } });
		if (updated.count !== 1)
			throw new CompanyAssistantToolsConflict();
		return { agentServiceId: service.id, activeRevisionId: revisionId, toolRevisionIds };
	}

	/** Resolves only the silo's stable company service, own Internal Principal and exact published source. */
	private async _CurrentCompany(siloId: string)
	{
		const service = await this.transaction.agentService.findFirst({ where: { id: __CompanyAssistantServiceId(siloId), siloId, kind: AgentServiceKind.Managed, state: AgentServiceState.Active, principal: { is: { siloId, provenance: PrincipalProvenance.Internal } } }, include: { activeRevision: { include: _AGENT_REVISION_INCLUDE } } });
		const revision = service?.activeRevision;
		if (service === null || service.principalId === null || revision === null || revision === undefined || service.activeRevisionId !== revision.id || revision.siloId !== siloId || revision.agentServiceId !== service.id || revision.state !== AgentRevisionState.Published || revision.publishedAt === null)
			throw new CompanyAssistantToolsUnavailable();
		return { ...service, principalId: service.principalId, activeRevision: revision };
	}

	/** Commits the first choices only; an existing result never means replacement choices were applied. */
	public async provision(caller: { readonly siloId: string; readonly principalId: string }, command: CompanyAssistantProvisioningCommand, now: Date): Promise<CompanyAssistantProvisioningResult>
	{
		const serviceId = __CompanyAssistantServiceId(caller.siloId);
		const argumentsDigest = ___DigestCanonicalJson({ serviceId, name: command.name, modelDefinitionId: command.modelDefinitionId, invokerPrincipalIds: [...command.invokerPrincipalIds].sort() });
		await this._Admit(caller, { kind: ProductAuthorizationResourceKinds.Organization, id: caller.siloId }, ProductAuthorizationActions.Administer, argumentsDigest, now);
		const existing = await this.transaction.agentService.findFirst({ where: { id: serviceId, siloId: caller.siloId }, include: { principal: true, revisions: { where: { revision: 1 } } } });
		if (existing !== null)
		{
			const first = existing.revisions[0];
			if (existing.kind !== AgentServiceKind.Managed || existing.state !== AgentServiceState.Active || existing.principal?.provenance !== PrincipalProvenance.Internal || existing.activeRevisionId === null || first === undefined)
				throw new CompanyAssistantProvisioningDenied();
			return { created: false, siloId: caller.siloId, agentServiceId: serviceId, agentRevisionId: existing.activeRevisionId, principalId: existing.principal.id, agentIdentityId: __ManagedAgentIdentityId(serviceId), name: existing.name, createdAt: existing.createdAt.toISOString(), createdByPrincipalId: first.authoredBy, identityEventId: first.id };
		}
		await this._ValidateChoices(caller.siloId, command);
		await this._Admit(caller, { kind: ProductAuthorizationResourceKinds.ModelDefinition, id: command.modelDefinitionId }, ProductAuthorizationActions.Use, argumentsDigest, now);
		const principalId = randomUUID();
		const revisionId = randomUUID();
		await this.transaction.principal.create({ data: { id: principalId, siloId: caller.siloId, issuer: "urn:opencrane:agent-service", subject: serviceId, provenance: PrincipalProvenance.Internal, email: null, displayName: command.name, createdAt: now } });
		await this.transaction.agentService.create({ data: { id: serviceId, siloId: caller.siloId, kind: AgentServiceKind.Managed, name: command.name, principalId, workloadProfile: this.policy.workloadProfile, state: AgentServiceState.Draft, createdAt: now } });
		await this.revisions.createDraft({ agentRevisionId: revisionId, siloId: caller.siloId, agentServiceId: serviceId, revision: 1, parentRevisionId: null, sourceRevisionId: null, content: { promptPolicyVersion: this.policy.promptPolicyVersion, personaRevisionId: null, modelDefinitionId: command.modelDefinitionId, budget: this.policy.budget, skills: [], mcpToolRevisionIds: [], boundaryAttachments: [] }, changeMessage: "Administrator provisioned the company assistant", authoredBy: caller.principalId, createdAt: now });
		const service = { kind: ProductAuthorizationResourceKinds.AgentService, id: serviceId };
		const model = { kind: ProductAuthorizationResourceKinds.ModelDefinition, id: command.modelDefinitionId };
		await this.grants.reconcileManagedResourceGrants({ siloId: caller.siloId, managerId: `company-assistant:${serviceId}`, resource: service, now, grants: command.invokerPrincipalIds.flatMap(principal => [ProductAuthorizationActions.Discover, ProductAuthorizationActions.Read, ProductAuthorizationActions.Invoke].map(action => _Grant(principal, caller.principalId, service, action))) });
		await this.grants.reconcileManagedResourceGrants({ siloId: caller.siloId, managerId: `company-assistant:${serviceId}`, resource: model, now, grants: [_Grant(principalId, caller.principalId, model, ProductAuthorizationActions.Use)] });
		await this.transaction.agentRevision.update({ where: { id: revisionId }, data: { state: AgentRevisionState.Published, publishedAt: now } });
		await this.transaction.agentService.update({ where: { id: serviceId }, data: { state: AgentServiceState.Active, activeRevisionId: revisionId } });
		return { created: true, siloId: caller.siloId, agentServiceId: serviceId, agentRevisionId: revisionId, principalId, agentIdentityId: __ManagedAgentIdentityId(serviceId), name: command.name, createdAt: now.toISOString(), createdByPrincipalId: caller.principalId, identityEventId: revisionId };
	}

	/** Requires a finite reviewed policy and explicit current human invokers before creating authority. */
	private async _ValidateChoices(siloId: string, command: CompanyAssistantProvisioningCommand): Promise<void>
	{
		if (!command.name.trim() || command.name !== command.name.trim() || command.name.length > 120 || !command.modelDefinitionId.trim() || command.invokerPrincipalIds.length < 1 || command.invokerPrincipalIds.length > 100 || new Set(command.invokerPrincipalIds).size !== command.invokerPrincipalIds.length || !this.policy.workloadProfile.trim() || !this.policy.promptPolicyVersion.trim() || Object.values(this.policy.budget).some(value => !Number.isSafeInteger(value) || value <= 0))
			throw new CompanyAssistantProvisioningDenied();
		const principals = await this.transaction.principal.findMany({ where: { siloId, id: { in: [...command.invokerPrincipalIds] }, provenance: PrincipalProvenance.External }, select: { id: true, subject: true } });
		if (principals.length !== command.invokerPrincipalIds.length)
			throw new CompanyAssistantProvisioningDenied();
		const memberships = await this.transaction.orgMembership.findMany({ where: { clusterTenant: siloId, subject: { in: principals.map(principal => principal.subject) }, status: OrgMemberStatus.Active }, select: { subject: true } });
		if (principals.some(principal => !memberships.some(member => member.subject === principal.subject)))
			throw new CompanyAssistantProvisioningDenied();
	}

	/** Requires recorded central authority before publishing durable assistant authority. */
	private async _Admit(caller: { readonly siloId: string; readonly principalId: string }, resource: ProductAuthorizationResourceLocator, action: ProductAuthorizationActions, argumentsDigest: `sha256:${string}`, now: Date): Promise<void>
	{
		const decision = await this.authorization.admitPrincipal({ ...caller, actorKind: "user", actorId: caller.principalId, resource, action, argumentsDigest, nowEpochMs: now.getTime() });
		if (decision.outcome !== AuthorizationDecisionOutcomes.Allow || decision.evidence === null)
			throw new CompanyAssistantProvisioningDenied();
	}
}

/** Derives one exact grant for selected human invokers or the assistant's own model and tool use. */
function _Grant(principalId: string, createdByPrincipalId: string, resource: ProductAuthorizationResourceLocator, action: ProductAuthorizationActions): ManagedAuthorizationGrantSpec
{
	const capability = __ProductAuthorizationCapability(resource.kind, action);
	if (capability === null)
		throw new CompanyAssistantProvisioningDenied();
	return { subject: { kind: AuthorizationSubjectKinds.Principal, principalId }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource, priority: 0, createdByPrincipalId };
}
