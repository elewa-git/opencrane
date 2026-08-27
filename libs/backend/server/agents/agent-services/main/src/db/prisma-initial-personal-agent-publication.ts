import { AgentRevisionState, AgentServiceKind, AgentServiceState, type Prisma } from "@prisma/client";

import type { AgentRevisionContent } from "@opencrane/models/agents";
import { __AppendAuditDecision } from "@opencrane/backend/server/iam/audit";
import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";

import { INITIAL_PERSONAL_AGENT_POLICY } from "../initial-personal-agent-policy";
import { InitialPersonalAgentDefaultModelResolutionStatuses, type InitialPersonalAgentDefaultModelResolver, type InitialPersonalAgentPublicationPersona, type InitialPersonalAgentPublicationRepository } from "../initial-personal-agent-publication.types";
import { PersonalAgentBootstrapDenialReasons, PersonalAgentBootstrapStatuses, type DeniedPersonalAgentBootstrapResult, type PersonalAgentBootstrapCommand, type PersonalAgentBootstrapResult } from "../personal-agent-bootstrap.types";
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
	/** App-provided adapter to model-routing's default-model authority in the same transaction. */
	private readonly defaultModelResolver: InitialPersonalAgentDefaultModelResolver;

	/** Creates the publication strategy inside the caller's Serializable transaction. */
	constructor(transaction: Prisma.TransactionClient, defaultModelResolver: InitialPersonalAgentDefaultModelResolver)
	{
		this.transaction = transaction;
		this.defaultModelResolver = defaultModelResolver;
	}

	/**
	 * Creates, publishes, activates, and audits the first personal Agent in the caller's transaction.
	 *
	 * Called by: `PrismaPersonalAgentBootstrapRepository` after it proves that no matching service
	 * exists. Default-model denial returns before the first service write; successful writes remain
	 * uncommitted until onboarding completion wins its compare-and-swap.
	 *
	 * @returns `Ready` after staging the active service, published revision, and audit; returns
	 * `Denied` when model-routing has no unambiguous accessible default.
	 * @throws When Prisma or audit persistence fails; the onboarding unit of work rolls back the
	 * transaction.
	 */
	async publish(command: PersonalAgentBootstrapCommand, persona: InitialPersonalAgentPublicationPersona): Promise<PersonalAgentBootstrapResult>
	{
		// 1. Resolve one default model so the first revision never stores an arbitrary route.
		const model = await this.defaultModelResolver.resolve(command.siloId);
		if (model.status === InitialPersonalAgentDefaultModelResolutionStatuses.Unavailable)
			return _Denied(PersonalAgentBootstrapDenialReasons.DefaultModelUnavailable);
		if (model.status === InitialPersonalAgentDefaultModelResolutionStatuses.Ambiguous)
			return _Denied(PersonalAgentBootstrapDenialReasons.DefaultModelAmbiguous);

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
			mcpToolRevisionIds: [],
			boundaryAttachments: [],
		};
		const cmd = {
			siloId: command.siloId,
			agentServiceId: service.id,
			revision: 1,
			parentRevisionId: null,
			sourceRevisionId: null,
			content,
			changeMessage: "Created by completed personal onboarding.",
			authoredBy: command.subjectId,
			createdAt: command.provisionedAt,
		};
		const task = new PrismaAgentRevisionWriterRepository(this.transaction);
		const revision = await task.createDraft(cmd);

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
