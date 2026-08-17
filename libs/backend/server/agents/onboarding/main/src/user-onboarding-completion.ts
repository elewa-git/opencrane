import { ___DoWithTrace } from "@opencrane/backend/observability";

import { UserOnboardingCompletionProvenances, UserOnboardingStates } from "./user-onboarding.enums";
import { UserOnboardingPersonalAgentBootstrapStatuses, UserOnboardingReadinessStatuses, type UserOnboardingCompletionEvidence, type UserOnboardingCompletionRepository, type UserOnboardingPersonalAgentBootstrapPort, type UserOnboardingReadinessResult } from "./user-onboarding-completion.types";
import type { UserOnboardingOwner } from "./user-onboarding.types";

/** Executes onboarding's completion decision over repositories bound to one transaction. */
export class __UserOnboardingCompletion
{
	/** Onboarding-owned transaction repository. */
	private readonly repository: UserOnboardingCompletionRepository;
	/** Agent-services-owned personal Agent bootstrap capability. */
	private readonly personalAgent: UserOnboardingPersonalAgentBootstrapPort;

	/** Bind the two domain capabilities supplied by one Serializable transaction attempt. */
	constructor(repository: UserOnboardingCompletionRepository, personalAgent: UserOnboardingPersonalAgentBootstrapPort)
	{
		this.repository = repository;
		this.personalAgent = personalAgent;
	}

	/** Provision the personal Agent before changing onboarding to completed. */
	async complete(owner: UserOnboardingOwner, conversationId: string, completedAt: Date): Promise<UserOnboardingReadinessResult>
	{
		const self = this;
		return ___DoWithTrace("user_onboarding.complete", _TraceOwner(owner), async function _Complete()
		{
			const evidence = await self.repository.readEvidence(owner);
			if (evidence === null) return _Result(UserOnboardingReadinessStatuses.OnboardingRequired);
			if (evidence.state === UserOnboardingStates.Completed) return self._repairCompleted(evidence, completedAt);
			if (evidence.state !== UserOnboardingStates.BootstrapChatInProgress || evidence.conversationId !== conversationId || !_ExactBootstrapEvidence(evidence)) return _Result(UserOnboardingReadinessStatuses.OnboardingRequired);

			const ready = await self._ensurePersonalAgent(evidence, completedAt, "completion");
			if (ready.status !== UserOnboardingReadinessStatuses.Ready) return ready;
			if (!await self.repository.markCompleted(owner, conversationId, completedAt)) return _Result(UserOnboardingReadinessStatuses.AuthorityUnavailable);
			return ready;
		});
	}

	/** Validate or repair only a completed bootstrap-concluded workflow. */
	async ensureReady(owner: UserOnboardingOwner, observedAt: Date): Promise<UserOnboardingReadinessResult>
	{
		const self = this;
		return ___DoWithTrace("user_onboarding.ensure_ready", _TraceOwner(owner), async function _EnsureReady()
		{
			const evidence = await self.repository.readEvidence(owner);
			if (evidence === null || evidence.state !== UserOnboardingStates.Completed) return _Result(UserOnboardingReadinessStatuses.OnboardingRequired);
			return self._repairCompleted(evidence, observedAt);
		});
	}

	/** Repair only rows that carry complete immutable bootstrap evidence. */
	private async _repairCompleted(evidence: UserOnboardingCompletionEvidence, observedAt: Date): Promise<UserOnboardingReadinessResult>
	{
		if (evidence.completionProvenance === UserOnboardingCompletionProvenances.ExistingUserMigration) return _Result(UserOnboardingReadinessStatuses.NotApplicable);
		if (evidence.completionProvenance !== UserOnboardingCompletionProvenances.BootstrapConcluded || !_ExactBootstrapEvidence(evidence)) return _Result(UserOnboardingReadinessStatuses.AuthorityUnavailable);
		return this._ensurePersonalAgent(evidence, observedAt, "repair");
	}

	/** Delegate all personal Agent persistence and model policy to agent-services. */
	private async _ensurePersonalAgent(evidence: UserOnboardingCompletionEvidence, provisionedAt: Date, readinessKind: "completion" | "repair"): Promise<UserOnboardingReadinessResult>
	{
		if (evidence.personaRevisionId === null) return _Result(UserOnboardingReadinessStatuses.AuthorityUnavailable);
		const result = await this.personalAgent.ensureReady({ onboardingId: evidence.onboardingId, siloId: evidence.siloId, subjectId: evidence.subjectId, onboardingPersonaRevisionId: evidence.personaRevisionId, readinessKind, provisionedAt });
		if (result.status !== UserOnboardingPersonalAgentBootstrapStatuses.Ready) return _Result(UserOnboardingReadinessStatuses.AuthorityUnavailable);
		return { status: UserOnboardingReadinessStatuses.Ready, agentServiceId: result.agentServiceId };
	}
}

/** Require the exact pinned three-question, three-answer bootstrap evidence. */
function _ExactBootstrapEvidence(evidence: UserOnboardingCompletionEvidence): boolean
{
	return evidence.conversationId !== null
		&& evidence.personaRevisionId !== null
		&& evidence.bootstrapPinsMatch
		&& evidence.questionCount === 3
		&& evidence.answeredQuestionOrdinals.length === 3
		&& evidence.answeredQuestionOrdinals.every(function _ExpectedOrdinal(ordinal, index) { return ordinal === index + 1; });
}

/** Build a result without an Agent identity. */
function _Result(status: Exclude<UserOnboardingReadinessStatuses, UserOnboardingReadinessStatuses.Ready>): UserOnboardingReadinessResult
{
	return { status, agentServiceId: null };
}

/** Keep traces owner-bound and free of bootstrap answers or persona content. */
function _TraceOwner(owner: UserOnboardingOwner): Record<string, unknown>
{
	return { siloId: owner.siloId, subjectId: owner.subjectId };
}
