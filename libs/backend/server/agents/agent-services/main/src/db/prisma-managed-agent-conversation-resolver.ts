import type { Prisma } from "@prisma/client";

import { __DigestHumanMembershipEvidence, __HumanMembershipRevision } from "@opencrane/backend/server/iam/membership";
import { AgentIdentityStates } from "@opencrane/contracts";
import { PrismaAuthorizationAuthority, __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import { __CompanyAssistantServiceId, __ManagedAgentIdentityId } from "../managed-agent-identity";
import type { CurrentManagedAgentConversation, ManagedAgentConversationCandidate, ManagedAgentConversationDependencies } from "../managed-agent.types";
import { PrismaManagedExecutionEvidenceRepository } from "./prisma-managed-execution-evidence-repository";

/** Resolves an already provisioned company assistant without creating identity or execution grants. */
export class PrismaManagedAgentConversationResolver
{
	/** Shares the caller's transaction and uses only deployment-provided profile and identity readers. */
	public constructor(private readonly transaction: Prisma.TransactionClient, private readonly dependencies: ManagedAgentConversationDependencies) {}

	/** Lists the explicitly provisioned company assistant only when this caller may both read and invoke it. */
	public async list(caller: { readonly siloId: string; readonly principalId: string }): Promise<readonly ManagedAgentConversationCandidate[]>
	{
		const current = await this._loadCandidate(caller, __CompanyAssistantServiceId(caller.siloId));
		if (current === null)
			return [];
		const { candidate, modelDefinitionId, nowEpochMs } = current;
		const authorization = new PrismaAuthorizationAuthority(this.transaction);
		const service = { kind: ProductAuthorizationResourceKinds.AgentService, id: candidate.agentServiceId };
		const commands = [
			{ principalId: caller.principalId, resource: service, action: ProductAuthorizationActions.Invoke },
			{ principalId: candidate.principalId, resource: { kind: ProductAuthorizationResourceKinds.ModelDefinition, id: modelDefinitionId }, action: ProductAuthorizationActions.Use },
			{ principalId: caller.principalId, resource: service, action: ProductAuthorizationActions.Discover },
			{ principalId: caller.principalId, resource: service, action: ProductAuthorizationActions.Read },
		];
		for (const command of commands)
		{
			const decision = await authorization.decidePrincipal({ ...command, siloId: caller.siloId, nowEpochMs });
			if (decision.outcome !== AuthorizationDecisionOutcomes.Allow)
				return [];
		}
		return [candidate];
	}

	/**
	 * Returns a candidate only while its current identity, revision and requester Invoke decision agree.
	 * Called by: the app's adapter for managed group-child conversation creation.
	 * @returns Null when current authority is absent or inactive; the child worker may end that request.
	 * @throws Propagates history transport and integrity failures so the child worker can retry them
	 * instead of treating a dependency failure as revoked authority.
	 * @see ManagedAgentConversationCandidate
	 */
	public async resolve(caller: { readonly siloId: string; readonly principalId: string }, agentServiceId: string): Promise<ManagedAgentConversationCandidate | null>
	{
		const current = await this._loadCandidate(caller, agentServiceId);
		if (current === null)
			return null;
		const { candidate, modelDefinitionId, membership, nowEpochMs } = current;
		const authorization = new PrismaAuthorizationAuthority(this.transaction);
		const argumentsDigest = __DigestCanonicalJson({ agentServiceId, agentRevisionId: candidate.agentRevisionId, agentIdentityId: candidate.agentIdentityId, membershipDigest: __DigestHumanMembershipEvidence(membership) });
		const decision = await authorization.admitPrincipal({ siloId: caller.siloId, principalId: caller.principalId, actorKind: "user", actorId: caller.principalId, resource: { kind: ProductAuthorizationResourceKinds.AgentService, id: agentServiceId }, action: ProductAuthorizationActions.Invoke, argumentsDigest, membershipRevision: __HumanMembershipRevision(membership), nowEpochMs });
		if (decision.outcome !== AuthorizationDecisionOutcomes.Allow || decision.evidence === null)
			return null;
		const model = await authorization.admitPrincipal({ siloId: caller.siloId, principalId: candidate.principalId, actorKind: "agent-service", actorId: candidate.principalId, resource: { kind: ProductAuthorizationResourceKinds.ModelDefinition, id: modelDefinitionId }, action: ProductAuthorizationActions.Use, argumentsDigest, nowEpochMs });
		if (model.outcome !== AuthorizationDecisionOutcomes.Allow || model.evidence === null)
			return null;
		return candidate;
	}

	/** Shares current service, identity, profile and human membership checks without admitting an operation. */
	private async _loadCandidate(caller: { readonly siloId: string; readonly principalId: string }, agentServiceId: string): Promise<CurrentManagedAgentConversation | null>
	{
		const repository = new PrismaManagedExecutionEvidenceRepository(this.transaction, this.dependencies.membershipConfig);
		const service = await repository.loadCurrent(caller.siloId, agentServiceId);
		if (service === null || service.principalId === caller.principalId)
			return null;
		const profiles = this.dependencies.profiles.filter(profile => profile.workloadProfile === service.workloadProfile);
		if (profiles.length !== 1 || profiles[0]!.profileRevisionId.trim().length === 0)
			return null;
		const agentIdentityId = __ManagedAgentIdentityId(agentServiceId);
		const current = await this.dependencies.identityHistory.load({ siloId: caller.siloId, agentIdentityId, agentServiceId, principalId: service.principalId });
		if (current === null || current.identity.kind !== "managed" || current.identity.state !== AgentIdentityStates.Active)
			return null;
		const nowEpochMs = this.dependencies.nowEpochMs?.() ?? Date.now();
		const membership = await repository.verifyRequesterMembership(caller.siloId, caller.principalId, nowEpochMs);
		if (membership === null)
			return null;
		const candidate = { agentServiceId, agentRevisionId: service.agentRevisionId, agentIdentityId, principalId: service.principalId, name: service.name, workloadProfile: service.workloadProfile, profileRevisionId: profiles[0]!.profileRevisionId };
		return { candidate, modelDefinitionId: service.modelDefinitionId, membership, nowEpochMs };
	}
}
