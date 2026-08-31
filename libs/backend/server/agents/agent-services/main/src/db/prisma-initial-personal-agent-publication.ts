import { randomUUID } from "node:crypto";

import { AgentRevisionState, AgentServiceKind, AgentServiceState, type Prisma } from "@prisma/client";

import type { AgentRevisionContent } from "@opencrane/models/agents";

import { INITIAL_PERSONAL_AGENT_POLICY } from "../initial-personal-agent-policy";
import { InitialPersonalAgentDefaultModelResolutionStatuses, type InitialPersonalAgentDefaultModelResolver, type InitialPersonalAgentPublicationPersona, type InitialPersonalAgentPublicationRepository } from "../initial-personal-agent-publication.types";
import { PersonalAgentBootstrapDenialReasons, PersonalAgentBootstrapStatuses, type DeniedPersonalAgentBootstrapResult, type PersonalAgentBootstrapCommand, type PersonalAgentBootstrapResult } from "../personal-agent-bootstrap.types";
import type { PersonalAgentProductCaller, PersonalAgentProductEffects } from "../personal-agent-product-effects.types";
import { PrismaPersonalAgentProductEffectsAuthority } from "../prisma-personal-agent-product-effects";
import { PrismaAgentRevisionWriterRepository } from "./prisma-agent-revision-writer";

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
	/** Shared product-effect adapter bound to the onboarding transaction. */
	private readonly productEffects: PersonalAgentProductEffects;

	/** Creates the publication strategy inside the caller's Serializable transaction. */
	constructor(transaction: Prisma.TransactionClient, defaultModelResolver: InitialPersonalAgentDefaultModelResolver, productEffects: PersonalAgentProductEffects | null = null)
	{
		this.transaction = transaction;
		this.defaultModelResolver = defaultModelResolver;
		this.productEffects = productEffects ?? new PrismaPersonalAgentProductEffectsAuthority(transaction);
	}

	/**
	 * Creates, publishes, and activates the first centrally admitted personal Agent.
	 *
	 * Called by: `PrismaPersonalAgentBootstrapRepository` after it proves that no matching service
	 * exists. Default-model denial returns before the first service write; successful writes remain
	 * uncommitted until onboarding completion wins its compare-and-swap.
	 *
	 * @returns `Ready` after staging the active service and published revision; returns
	 * `Denied` when model-routing has no unambiguous accessible default.
	 * @throws When central admission or Prisma persistence fails; the onboarding unit of work rolls
	 * back the transaction.
	 */
	async publish(command: PersonalAgentBootstrapCommand, persona: InitialPersonalAgentPublicationPersona, caller: PersonalAgentProductCaller): Promise<PersonalAgentBootstrapResult>
	{
		// 1. Resolve one default model so the first revision never stores an arbitrary route.
		const model = await this.defaultModelResolver.resolve(command.siloId);
		if (model.status === InitialPersonalAgentDefaultModelResolutionStatuses.Unavailable)
			return _Denied(PersonalAgentBootstrapDenialReasons.DefaultModelUnavailable);
		if (model.status === InitialPersonalAgentDefaultModelResolutionStatuses.Ambiguous)
			return _Denied(PersonalAgentBootstrapDenialReasons.DefaultModelAmbiguous);
		const definition = await this.transaction.modelDefinition.findUnique({ where: { id_siloId: { id: model.modelDefinitionId, siloId: command.siloId } }, select: { id: true } });
		if (definition === null)
			return _Denied(PersonalAgentBootstrapDenialReasons.DefaultModelUnavailable);

		// 2. Preallocate the revision and admit creation through the existing silo collection root.
		const agentRevisionId = randomUUID();
		const productCommand = {
			caller,
			agentServiceId: command.onboardingId,
			agentRevisionId,
			personaProfileId: persona.profileId,
			modelDefinitionId: model.modelDefinitionId,
			now: command.provisionedAt,
			argumentsValue: { onboardingId: command.onboardingId, onboardingPersonaRevisionId: command.onboardingPersonaRevisionId, materializedPersonaRevisionId: persona.id, readinessKind: command.readinessKind, provisionedAt: command.provisionedAt.toISOString() },
		};
		await this.productEffects.admitInitialCreation(productCommand);

		// 3. Create the stable service and its first draft through the shared revision writer.
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
			agentRevisionId,
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

		// 4. Project exact relation grants now that both rows exist, then admit publication.
		await this.productEffects.admitInitialPublication(productCommand);

		// 5. Publish and activate before the surrounding onboarding transaction commits.
		await this.transaction.agentRevision.update({
			where: { id_siloId: { id: revision.id, siloId: command.siloId } },
			data: { state: AgentRevisionState.Published, publishedAt: command.provisionedAt },
		});
		await this.transaction.agentService.update({
			where: { id_siloId: { id: service.id, siloId: command.siloId } },
			data: { state: AgentServiceState.Active, activeRevisionId: revision.id, updatedAt: command.provisionedAt },
		});
		return { status: PersonalAgentBootstrapStatuses.Ready, agentServiceId: service.id, agentRevisionId: revision.id, created: true, revised: false };
	}
}
