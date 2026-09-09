import { randomUUID } from "node:crypto";
import { AgentRevisionState, AgentServiceKind, AgentServiceState, OrgMemberStatus, PrincipalProvenance, type Prisma } from "@prisma/client";
import { PrismaAuthorizationAuthority, PrismaManagedAuthorizationGrantRepository, type AuthorizationAuthority, type ManagedAuthorizationGrantRepository, type ManagedAuthorizationGrantSpec } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationDecisionOutcomes, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability, type ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";

import type { CompanyAssistantProvisioningCommand, CompanyAssistantProvisioningPolicy, CompanyAssistantProvisioningRepository, CompanyAssistantProvisioningResult } from "../company-assistant-provisioning.types";
import { __CompanyAssistantServiceId, __ManagedAgentIdentityId } from "../managed-agent-identity";
import { PrismaAgentRevisionWriterRepository } from "./prisma-agent-revision-writer";

/** Stops provisioning without exposing the administrator's grants or other members' identities. */
export class CompanyAssistantProvisioningDenied extends Error
{
	/** Supplies one rollback error for invalid choices or refused authority. */
	public constructor() { super("Company assistant provisioning was not authorized or available"); }
}

/**
 * Publishes the silo's one company assistant and its exact initial grants in the caller's transaction.
 *
 * Called by: the administrator setup composition, inside a Serializable transaction that retries
 * unique-create races. Existing assistants are returned without changing their grants or state.
 * Kurrent identity establishment follows commit through __EnsureCompanyAssistantIdentity.
 * @see CompanyAssistantProvisioningCommand for the explicit administrator choices.
 */
export class PrismaCompanyAssistantProvisioningRepository implements CompanyAssistantProvisioningRepository
{
	private readonly authorization: AuthorizationAuthority;
	private readonly grants: ManagedAuthorizationGrantRepository;

	/** Binds all PostgreSQL writes and decisions to the same transaction. */
	public constructor(private readonly transaction: Prisma.TransactionClient, private readonly policy: CompanyAssistantProvisioningPolicy, authorization?: AuthorizationAuthority, grants?: ManagedAuthorizationGrantRepository)
	{
		this.authorization = authorization ?? new PrismaAuthorizationAuthority(this.transaction);
		this.grants = grants ?? new PrismaManagedAuthorizationGrantRepository(this.transaction);
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
		await new PrismaAgentRevisionWriterRepository(this.transaction).createDraft({ agentRevisionId: revisionId, siloId: caller.siloId, agentServiceId: serviceId, revision: 1, parentRevisionId: null, sourceRevisionId: null, content: { promptPolicyVersion: this.policy.promptPolicyVersion, personaRevisionId: null, modelDefinitionId: command.modelDefinitionId, budget: this.policy.budget, skills: [], mcpToolRevisionIds: [], boundaryAttachments: [] }, changeMessage: "Administrator provisioned the company assistant", authoredBy: caller.principalId, createdAt: now });
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

/** Derives one exact grant from the administrator's selected humans or the assistant's own model use. */
function _Grant(principalId: string, createdByPrincipalId: string, resource: ProductAuthorizationResourceLocator, action: ProductAuthorizationActions): ManagedAuthorizationGrantSpec
{
	const capability = __ProductAuthorizationCapability(resource.kind, action);
	if (capability === null)
		throw new CompanyAssistantProvisioningDenied();
	return { subject: { kind: AuthorizationSubjectKinds.Principal, principalId }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource, priority: 0, createdByPrincipalId };
}
