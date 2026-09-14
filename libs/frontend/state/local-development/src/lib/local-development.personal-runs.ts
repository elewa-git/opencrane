import { type ConversationPersonalRun, type ConversationPersonalRunsGateway } from "@opencrane/state/conversation/workspace";
import { PersonaOnboardingStates } from "@opencrane/state/onboarding";

import { _LOCAL_DEVELOPMENT_NOW, _LOCAL_DEVELOPMENT_PERSONAL_AGENT_CONVERSATION_ID } from "./local-development.fixture-coordinates";
import type { _LocalDevelopmentState } from "./local-development.owner.types";
import { LocalDevelopmentScenarios } from "./local-development.types";

/**
 * Projects the selected Tier 1 scenario into the personal-run read model after onboarding completes.
 * The failed-run scenario reports a terminal failure; every other ready persona reports a completed fixture run.
 */
export function _CreateLocalDevelopmentPersonalRuns(state: _LocalDevelopmentState): ConversationPersonalRunsGateway
{
	/** Lists the personal run that belongs to the selected local scenario. */
	async function _ListPersonalRuns(_signal: AbortSignal): Promise<readonly ConversationPersonalRun[]>
	{
		if (state.persona.state !== PersonaOnboardingStates.Ready)
		{
			return [];
		}

		const failed = state.scenario === LocalDevelopmentScenarios.FailedRun;

		return [{
			runId: "local-run",
			conversationId: _LOCAL_DEVELOPMENT_PERSONAL_AGENT_CONVERSATION_ID,
			state: failed ? "failed" : "completed",
			attempt: 1,
			agentRevisionId: `local-persona-${state.archetype}`,
			acceptedAt: _LOCAL_DEVELOPMENT_NOW,
			finishedAt: _LOCAL_DEVELOPMENT_NOW
		}];
	}

	return { listPersonalRuns: _ListPersonalRuns };
}
