import type { Prisma } from "@prisma/client";

import { PrismaAuthorizationAuthority, PrismaManagedAuthorizationGrantRepository, type AuthorizationAuthority, type ManagedAuthorizationGrantRepository, type ManagedAuthorizationGrantSpec } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationDecisionOutcomes, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability, type ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { PersonalAgentSelectedResourceKinds, type AdmitInitialPersonalAgentPublicationCommand, type AdmitPersonalAgentRevisionSelectionCommand, type PersonalAgentCurrentResources, type PersonalAgentProductCaller, type PersonalAgentProductEffects } from "./personal-agent-product-effects.types";

/** Prefixes grants derived from one durable personal-agent owner and its revision relations. */
const _PERSONAL_AGENT_OWNER_GRANT_MANAGER_ID = "personal-agent-owner-access";

/** Stops a transaction when the central authority refuses a projected personal-agent effect. */
export class PersonalAgentProductEffectDenied extends Error
{
	/** Creates the rollback signal without exposing grant or policy details. */
	constructor()
	{
		super("personal-agent product effect was not authorized");
		this.name = PersonalAgentProductEffectDenied.name;
	}
}

/**
 * Projects personal-owner grants and asks the shared authority to admit product effects.
 *
 * This adapter does not evaluate policy. It derives managed grants from the personal Agent's
 * durable owner and selected-resource relations, then delegates every decision to the central
 * transaction-bound {@link PrismaAuthorizationAuthority}. A denial throws so the caller's
 * Serializable transaction rolls back both the grant projection and every protected write.
 *
 * Called by: personal-agent bootstrap, persona selection, and personal configuration materialization.
 *
 * @implements PersonalAgentProductEffects
 */
export class PrismaPersonalAgentProductEffectsAuthority implements PersonalAgentProductEffects
{
	/** Transaction used to resolve the external subject to a local Principal. */
	private readonly transaction: Prisma.TransactionClient;
	/** Shared authority that makes and records every product decision. */
	private readonly authorization: AuthorizationAuthority;
	/** Shared managed-grant writer used for owner and selected-resource projections. */
	private readonly managedGrants: ManagedAuthorizationGrantRepository;

	/** Binds grant projection and decisions to the caller's open transaction. */
	constructor(transaction: Prisma.TransactionClient, authorization: AuthorizationAuthority | null = null, managedGrants: ManagedAuthorizationGrantRepository | null = null)
	{
		this.transaction = transaction;
		this.authorization = authorization ?? new PrismaAuthorizationAuthority(transaction);
		this.managedGrants = managedGrants ?? new PrismaManagedAuthorizationGrantRepository(transaction);
	}

	/** @inheritdoc */
	async resolveCaller(siloId: string, subjectId: string): Promise<PersonalAgentProductCaller | null>
	{
		const principals = await this.transaction.principal.findMany({ where: { siloId, subject: subjectId }, select: { id: true, subject: true }, take: 2 });
		const principal = principals[0];
		if (principals.length !== 1 || principal === undefined || principal.subject !== subjectId)
			return null;
		return { siloId, principalId: principal.id, subjectId };
	}

	/** @inheritdoc */
	async reconcileCurrent(caller: PersonalAgentProductCaller, resources: PersonalAgentCurrentResources, now: Date): Promise<void>
	{
		await this._ReconcileResourceGrants(caller, { kind: ProductAuthorizationResourceKinds.AgentService, id: resources.agentServiceId }, _SERVICE_ACTIONS, now);
		await this._ReconcileResourceGrants(caller, { kind: ProductAuthorizationResourceKinds.AgentRevision, id: resources.agentRevisionId }, _REVISION_ACTIONS, now);
		await this._ReconcileResourceGrants(caller, { kind: ProductAuthorizationResourceKinds.Persona, id: resources.personaProfileId }, [ProductAuthorizationActions.Use], now);
		await this._ReconcileResourceGrants(caller, { kind: ProductAuthorizationResourceKinds.ModelDefinition, id: resources.modelDefinitionId }, _MODEL_ACTIONS, now);
	}

	/** @inheritdoc */
	async admitInitialCreation(command: AdmitInitialPersonalAgentPublicationCommand): Promise<void>
	{
		const argumentsDigest = ___DigestCanonicalJson(command.argumentsValue);
		await this._Admit(command.caller, { kind: ProductAuthorizationResourceKinds.AgentServiceCollection, id: command.caller.siloId }, ProductAuthorizationActions.Create, argumentsDigest, command.now);
	}

	/** @inheritdoc */
	async admitInitialPublication(command: AdmitInitialPersonalAgentPublicationCommand): Promise<void>
	{
		await this.reconcileCurrent(command.caller, command, command.now);
		const argumentsDigest = ___DigestCanonicalJson(command.argumentsValue);
		await this._Admit(command.caller, { kind: ProductAuthorizationResourceKinds.Persona, id: command.personaProfileId }, ProductAuthorizationActions.Use, argumentsDigest, command.now);
		await this._Admit(command.caller, { kind: ProductAuthorizationResourceKinds.ModelDefinition, id: command.modelDefinitionId }, ProductAuthorizationActions.Use, argumentsDigest, command.now);
		await this._Admit(command.caller, { kind: ProductAuthorizationResourceKinds.AgentRevision, id: command.agentRevisionId }, ProductAuthorizationActions.Edit, argumentsDigest, command.now);
		await this._Admit(command.caller, { kind: ProductAuthorizationResourceKinds.AgentRevision, id: command.agentRevisionId }, ProductAuthorizationActions.Publish, argumentsDigest, command.now);
		await this._Admit(command.caller, { kind: ProductAuthorizationResourceKinds.AgentService, id: command.agentServiceId }, ProductAuthorizationActions.Publish, argumentsDigest, command.now);
	}

	/** @inheritdoc */
	async admitRevisionSelection(command: AdmitPersonalAgentRevisionSelectionCommand): Promise<void>
	{
		await this.reconcileCurrent(command.caller, command.source, command.now);
		const argumentsDigest = ___DigestCanonicalJson(command.argumentsValue);
		await this._Admit(command.caller, { kind: ProductAuthorizationResourceKinds.AgentService, id: command.source.agentServiceId }, ProductAuthorizationActions.Edit, argumentsDigest, command.now);
		if (command.selectedResource === PersonalAgentSelectedResourceKinds.Persona)
		{
			await this._Admit(command.caller, { kind: ProductAuthorizationResourceKinds.Persona, id: command.target.personaProfileId }, ProductAuthorizationActions.Use, argumentsDigest, command.now);
		}
		else
		{
			await this._Admit(command.caller, { kind: ProductAuthorizationResourceKinds.ModelDefinition, id: command.target.modelDefinitionId }, ProductAuthorizationActions.Use, argumentsDigest, command.now);
		}
	}

	/** @inheritdoc */
	async admitRevisionPublication(command: AdmitPersonalAgentRevisionSelectionCommand): Promise<void>
	{
		await this.reconcileCurrent(command.caller, command.target, command.now);
		const argumentsDigest = ___DigestCanonicalJson(command.argumentsValue);
		await this._Admit(command.caller, { kind: ProductAuthorizationResourceKinds.AgentRevision, id: command.target.agentRevisionId }, ProductAuthorizationActions.Edit, argumentsDigest, command.now);
		await this._Admit(command.caller, { kind: ProductAuthorizationResourceKinds.AgentRevision, id: command.target.agentRevisionId }, ProductAuthorizationActions.Publish, argumentsDigest, command.now);
	}

	/** Writes the complete owner grant set for one exact resource. */
	private async _ReconcileResourceGrants(caller: PersonalAgentProductCaller, resource: ProductAuthorizationResourceLocator, actions: readonly ProductAuthorizationActions[], now: Date): Promise<void>
	{
		const grants = actions.map(function _Grant(action): ManagedAuthorizationGrantSpec
		{
			const capability = __ProductAuthorizationCapability(resource.kind, action);
			if (capability === null)
				throw new Error(`personal-agent capability is missing for ${resource.kind}:${action}`);
			return { subject: { kind: AuthorizationSubjectKinds.Principal, principalId: caller.principalId }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId: caller.principalId }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource, priority: 0, createdByPrincipalId: caller.principalId };
		});
		const managerId = `${_PERSONAL_AGENT_OWNER_GRANT_MANAGER_ID}:${caller.principalId}`;
		await this.managedGrants.reconcileManagedResourceGrants({ siloId: caller.siloId, managerId, resource, grants, now });
	}

	/** Delegates one protected effect to the central authority and rolls back on denial. */
	private async _Admit(caller: PersonalAgentProductCaller, resource: ProductAuthorizationResourceLocator, action: ProductAuthorizationActions, argumentsDigest: `sha256:${string}`, now: Date): Promise<void>
	{
		const result = await this.authorization.admitPrincipal({ siloId: caller.siloId, principalId: caller.principalId, actorKind: "user", actorId: caller.principalId, resource, action, argumentsDigest, nowEpochMs: now.getTime() });
		if (result.outcome !== AuthorizationDecisionOutcomes.Allow)
			throw new PersonalAgentProductEffectDenied();
	}
}

/** Complete exact-owner actions for one stable personal AgentService. */
const _SERVICE_ACTIONS = [ProductAuthorizationActions.Discover, ProductAuthorizationActions.Read, ProductAuthorizationActions.Create, ProductAuthorizationActions.Edit, ProductAuthorizationActions.Publish, ProductAuthorizationActions.Invoke, ProductAuthorizationActions.Schedule, ProductAuthorizationActions.Retire, ProductAuthorizationActions.Administer] as const;

/** Complete exact-owner actions for one immutable personal AgentRevision. */
const _REVISION_ACTIONS = [ProductAuthorizationActions.Read, ProductAuthorizationActions.Create, ProductAuthorizationActions.Edit, ProductAuthorizationActions.Publish, ProductAuthorizationActions.Assign, ProductAuthorizationActions.Revoke] as const;

/** Read and runtime-use actions retained for every model referenced by personal revision history. */
const _MODEL_ACTIONS = [ProductAuthorizationActions.Discover, ProductAuthorizationActions.Read, ProductAuthorizationActions.Use] as const;
