import type { Provider } from "@angular/core";

import { CONVERSATION_ASSETS_GATEWAY } from "@opencrane/state/conversation/assets";
import { CONVERSATION_COMPUTER_REVIEW_GATEWAY, CONVERSATION_CURRENT_SUBJECT, CONVERSATION_GROUP_CHILD_GATEWAY, CONVERSATION_PERSONAL_RUNS_GATEWAY, CONVERSATION_WORKSPACE_EVENT_STREAM, CONVERSATION_WORKSPACE_GATEWAY } from "@opencrane/state/conversation/workspace";
import { PERSONA_FIRST_CHAT_GATEWAY, PERSONA_GATEWAY } from "@opencrane/state/onboarding";

import { _CreateLocalDevelopmentOwner } from "./local-development.owner";
import type { LocalDevelopmentConfig } from "./local-development.types";

/**
 * Binds every Tier 1 API port to one disposable, network-free state owner.
 *
 * Called by: the OpenCrane UI local-development application configuration.
 *
 * @param config - Optional reviewed archetype and deterministic scenario.
 * @returns Angular providers that replace every current onboarding and conversation transport port.
 */
export function provideLocalDevelopmentGateways(config: LocalDevelopmentConfig = {}): Provider[]
{
	const owner = _CreateLocalDevelopmentOwner(config);
	return [
		{ provide: PERSONA_GATEWAY, useValue: owner.persona },
		{ provide: PERSONA_FIRST_CHAT_GATEWAY, useValue: owner.firstChat },
		{ provide: CONVERSATION_WORKSPACE_GATEWAY, useValue: owner.workspace },
		{ provide: CONVERSATION_WORKSPACE_EVENT_STREAM, useValue: owner.stream },
		{ provide: CONVERSATION_CURRENT_SUBJECT, useValue: owner.subject },
		{ provide: CONVERSATION_ASSETS_GATEWAY, useValue: owner.assets },
		{ provide: CONVERSATION_PERSONAL_RUNS_GATEWAY, useValue: owner.personalRuns },
		{ provide: CONVERSATION_GROUP_CHILD_GATEWAY, useValue: owner.groupChildren },
		{ provide: CONVERSATION_COMPUTER_REVIEW_GATEWAY, useValue: owner.computerReview }
	];
}
