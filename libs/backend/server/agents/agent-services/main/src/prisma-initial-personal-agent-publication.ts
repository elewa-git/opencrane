import { AgentRevisionState, AgentServiceKind, AgentServiceState, ModelRoutingScope, type Prisma } from "@prisma/client";

import type { AgentRevisionContent } from "@opencrane/models/agents";
import { __AppendAuditDecision } from "@opencrane/backend/server/iam/audit";
import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";

import { INITIAL_PERSONAL_AGENT_POLICY } from "./initial-personal-agent-policy";
import type { InitialPersonalAgentPublicationPersona, InitialPersonalAgentPublicationRepository } from "./initial-personal-agent-publication.types";
import { PersonalAgentBootstrapDenialReasons, PersonalAgentBootstrapStatuses, type DeniedPersonalAgentBootstrapResult, type PersonalAgentBootstrapCommand, type PersonalAgentBootstrapResult } from "./personal-agent-bootstrap.types";
import { PrismaAgentRevisionWriterRepository } from "./prisma-agent-revision-writer";

/** Capability catalogue recorded for the onboarding-owned initial publication. */
const _PERSONAL_AGENT_BOOTSTRAP_CATALOG_ID = "opencrane-personal-agent-bootstrap";

/** Returns a stable denied result without writing authority state. */
function _Denied(reason: PersonalAgentBootstrapDenialReasons): DeniedPersonalAgentBootstrapResult
{
	return { status: PersonalAgentBootstrapStatuses.Denied, reason };
}

/** Publishes the first revision after bootstrap has proved that no personal service exists. */
export class PrismaInitialPersonalAgentPublicationRepository implements InitialPersonalAgentPublicationRepository
{
	/** Transaction-scoped ORM client supplied by the onboarding completion unit of work. */
	private readonly transaction: Prisma.TransactionClient;

	/** Creates the publication strategy inside the caller's Serializable transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Creates, publishes, activates, and audits the initial personal Agent. */
	async publish(command: PersonalAgentBootstrapCommand, persona: InitialPersonalAgentPublicationPersona): Promise<PersonalAgentBootstrapResult>
	{
		// 1. Resolve one default model so the first revision never stores an arbitrary route.
		const model = await this._ResolveDefaultModel(command.siloId);
		if (model.status === PersonalAgentBootstrapStatuses.Denied) return model;

		// 2. Create the stable service and its first draft through the shared revision writer.
		const service = await this.transaction.agentService.create({
			data: {
				id: command.onboardingId,
				siloId: command.siloId,
				kind: AgentServiceKind.Personal,
				name: persona.displayName,
				state: AgentServiceState.Draft,
				workloadProfile: INITIAL_PERSONAL_AGENT_POLICY.workloadProfile,
				createdAt: command.provisionedAt,
				updatedAt: command.provisionedAt,
			},
		});
		const content: AgentRevisionContent = {
			promptPolicyVersion: INITIAL_PERSONAL_AGENT_POLICY.promptPolicyVersion,
			personaRevisionId: persona.id,
			modelDefinitionId: model.modelDefinitionId,
			budget: INITIAL_PERSONAL_AGENT_POLICY.budget,
			skills: [],
			integrationAssignments: [],
			scopeAttachments: [],
		};
		const revision = await new PrismaAgentRevisionWriterRepository(this.transaction).createDraft({
			siloId: command.siloId,
			agentServiceId: service.id,
			revision: 1,
			parentRevisionId: null,
			sourceRevisionId: null,
			content,
			changeMessage: "Created by completed personal onboarding.",
			authoredBy: command.subjectId,
			createdAt: command.provisionedAt,
		});

		// 3. Publish, activate, and audit before the surrounding onboarding transaction commits.
		await this.transaction.agentRevision.update({
			where: { id: revision.id },
			data: { state: AgentRevisionState.Published, publishedAt: command.provisionedAt },
		});
		await this.transaction.agentService.update({
			where: { id: service.id },
			data: { state: AgentServiceState.Active, activeRevisionId: revision.id, updatedAt: command.provisionedAt },
		});
		await __AppendAuditDecision(this.transaction, this._BuildAuditDecision(command, persona.id, revision.id, revision.digest));
		return { status: PersonalAgentBootstrapStatuses.Ready, agentServiceId: service.id, agentRevisionId: revision.id, created: true, revised: false };
	}

	/** Resolves the unique silo default, or the unique global default when the silo has none. */
	private async _ResolveDefaultModel(siloId: string): Promise<{ readonly status: PersonalAgentBootstrapStatuses.Ready; readonly modelDefinitionId: string } | DeniedPersonalAgentBootstrapResult>
	{
		const tenant = await this.transaction.modelDefinition.findMany({
			where: { scope: ModelRoutingScope.ClusterTenant, clusterTenant: siloId, isDefault: true },
			select: { id: true },
			orderBy: { id: "asc" },
			take: 2,
		});
		if (tenant.length > 1) return _Denied(PersonalAgentBootstrapDenialReasons.DefaultModelAmbiguous);
		if (tenant.length === 1)
		{
			const selected = tenant[0];
			if (selected === undefined) return _Denied(PersonalAgentBootstrapDenialReasons.DefaultModelUnavailable);
			return { status: PersonalAgentBootstrapStatuses.Ready, modelDefinitionId: selected.id };
		}
		const global = await this.transaction.modelDefinition.findMany({
			where: { scope: ModelRoutingScope.Global, clusterTenant: null, isDefault: true },
			select: { id: true },
			orderBy: { id: "asc" },
			take: 2,
		});
		if (global.length > 1) return _Denied(PersonalAgentBootstrapDenialReasons.DefaultModelAmbiguous);
		if (global.length === 0) return _Denied(PersonalAgentBootstrapDenialReasons.DefaultModelUnavailable);
		const selected = global[0];
		if (selected === undefined) return _Denied(PersonalAgentBootstrapDenialReasons.DefaultModelUnavailable);
		return { status: PersonalAgentBootstrapStatuses.Ready, modelDefinitionId: selected.id };
	}

	/** Builds append-only publication evidence from the bootstrap command and revision digest. */
	private _BuildAuditDecision(command: PersonalAgentBootstrapCommand, personaRevisionId: string, agentRevisionId: string, agentRevisionDigest: string)
	{
		const argumentsDigest = __DigestCanonicalJson({ onboardingId: command.onboardingId, onboardingPersonaRevisionId: command.onboardingPersonaRevisionId, materializedPersonaRevisionId: personaRevisionId, readinessKind: command.readinessKind, provisionedAt: command.provisionedAt.toISOString() });
		const effectiveAuthorizationDigest = __DigestCanonicalJson({ actor: command.subjectId, siloId: command.siloId, personaRevisionId, agentRevisionDigest });
		const decisionDigest = __DigestCanonicalJson({ argumentsDigest, effectiveAuthorizationDigest, action: "publish", resourceId: command.onboardingId });
		return {
			decisionDigest,
			siloId: command.siloId,
			actorKind: "user" as const,
			actorId: command.subjectId,
			resourceKind: "agent-service",
			resourceId: command.onboardingId,
			agentServiceId: command.onboardingId,
			agentRevisionId,
			action: "publish",
			catalogId: _PERSONAL_AGENT_BOOTSTRAP_CATALOG_ID,
			catalogRevision: 1,
			catalogDigest: __DigestCanonicalJson({ catalog: _PERSONAL_AGENT_BOOTSTRAP_CATALOG_ID, revision: 1 }),
			argumentsDigest,
			policyRevisionHash: __DigestCanonicalJson({ policy: "personal-agent-bootstrap", revision: 1 }),
			effectiveAuthorizationDigest,
			outcome: "allow" as const,
			reasonCode: "onboarding_completed",
			decidedAt: command.provisionedAt,
		};
	}
}
