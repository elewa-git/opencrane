import { HttpBackend } from "@angular/common/http";
import type { Provider } from "@angular/core";

import { OPENCRANE_API_FETCH } from "@opencrane/core";
import { PersonaFirstChatArchetypes } from "@opencrane/models/user-onboarding";
import { AGENT_THREAD_GATEWAY } from "@opencrane/state/conversation/agent-threads";
import { CONVERSATION_ASSETS_GATEWAY } from "@opencrane/state/conversation/assets";
import { ELICITATION_GATEWAY } from "@opencrane/state/conversation/elicitation";
import { CONVERSATION_WORKSPACE_EVENT_STREAM, CONVERSATION_WORKSPACE_GATEWAY } from "@opencrane/state/conversation/workspace";
import { SESSION_GATEWAY } from "@opencrane/state/core";
import { PERSONA_FIRST_CHAT_GATEWAY, PERSONA_GATEWAY } from "@opencrane/state/onboarding";

import { LocalDevelopmentAgentThreadGateway } from "./local-development-agent-thread.gateway";
import { LOCAL_DEVELOPMENT_ARCHETYPE } from "./local-development-archetype";
import { LocalDevelopmentConversationAssetsGateway } from "./local-development-assets.gateway";
import { LocalDevelopmentConversationElicitationGateway } from "./local-development-elicitation.gateway";
import { LocalDevelopmentConversationEventStream } from "./local-development-event-stream.gateway";
import { LocalDevelopmentPersonaFirstChatGateway } from "./local-development-first-chat.gateway";
import { LocalDevelopmentHttpBackend, rejectLocalDevelopmentFetch } from "./local-development-http-backend";
import { LocalDevelopmentPersonaGateway } from "./local-development-persona.gateway";
import { LOCAL_DEVELOPMENT_SCENARIO } from "./local-development-scenario";
import { LocalDevelopmentScenarioKinds } from "./local-development-scenario.types";
import { LocalDevelopmentSessionGateway } from "./local-development-session.gateway";
import { LocalDevelopmentState } from "./local-development-state";
import { LocalDevelopmentConversationWorkspaceGateway } from "./local-development-workspace.gateway";

/**
 * Binds every Tier 1 onboarding/chat port to adapters that share one
 * {@link LocalDevelopmentState}. It also replaces Angular's HTTP backend with a tripwire, so an
 * omitted local binding fails in the browser before an `HttpClient` request can reach a network.
 *
 * Called by: `OPENCRANE_UI_GATEWAY_PROVIDERS` in `gateway-profile.providers.local.ts`, which the
 * default development build substitutes for the live entry point.
 * @returns Providers to install together at the application root.
 */
export function provideLocalDevelopmentGateways(): Provider[]
{
	return [
		{ provide: LOCAL_DEVELOPMENT_ARCHETYPE, useValue: PersonaFirstChatArchetypes.Commander },
		{ provide: LOCAL_DEVELOPMENT_SCENARIO, useValue: LocalDevelopmentScenarioKinds.HappyPath },
		LocalDevelopmentState,
		{ provide: HttpBackend, useClass: LocalDevelopmentHttpBackend },
		{ provide: OPENCRANE_API_FETCH, useValue: rejectLocalDevelopmentFetch },
		{ provide: SESSION_GATEWAY, useClass: LocalDevelopmentSessionGateway },
		{ provide: PERSONA_GATEWAY, useClass: LocalDevelopmentPersonaGateway },
		{ provide: PERSONA_FIRST_CHAT_GATEWAY, useClass: LocalDevelopmentPersonaFirstChatGateway },
		LocalDevelopmentConversationWorkspaceGateway,
		{ provide: CONVERSATION_WORKSPACE_GATEWAY, useExisting: LocalDevelopmentConversationWorkspaceGateway },
		{ provide: CONVERSATION_WORKSPACE_EVENT_STREAM, useClass: LocalDevelopmentConversationEventStream },
		{ provide: CONVERSATION_ASSETS_GATEWAY, useClass: LocalDevelopmentConversationAssetsGateway },
		{ provide: ELICITATION_GATEWAY, useClass: LocalDevelopmentConversationElicitationGateway },
		{ provide: AGENT_THREAD_GATEWAY, useClass: LocalDevelopmentAgentThreadGateway }
	];
}
