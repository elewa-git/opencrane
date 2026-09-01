import type { Provider } from "@angular/core";

import { AGENT_THREAD_GATEWAY, OpenCraneAgentThreadGateway } from "@opencrane/state/conversation/agent-threads";
import { OpenCranePersonalAssetsGateway, PERSONAL_ASSETS_GATEWAY } from "@opencrane/state/assets/adapter";
import { CONVERSATION_ASSETS_GATEWAY, OpenCraneConversationAssetsGateway } from "@opencrane/state/conversation/assets";
import { OpenCraneConversationEventStream } from "@opencrane/state/conversation/adapter";
import { ELICITATION_GATEWAY, OpenCraneConversationElicitationGateway } from "@opencrane/state/conversation/elicitation";
import { CONVERSATION_WORKSPACE_EVENT_STREAM, CONVERSATION_WORKSPACE_GATEWAY } from "@opencrane/state/conversation/workspace";
import { OpenCraneConversationWorkspaceGateway } from "@opencrane/state/conversation/workspace/adapter";
import { SESSION_GATEWAY } from "@opencrane/state/session";
import { OpenCraneSessionGateway } from "@opencrane/state/session/adapter";
import { MCP_GATEWAY, OpenCraneMcpGateway } from "@opencrane/state/mcp/adapter";
import { OpenCranePersonaFirstChatGateway, PERSONA_FIRST_CHAT_GATEWAY, PERSONA_GATEWAY } from "@opencrane/state/onboarding";
import { ORGANIZATION_MEMBERS_GATEWAY } from "@opencrane/state/organization/members";
import { OpenCraneOrganizationMembersGateway } from "@opencrane/state/organization/members/adapter";
import { OpenCranePersonaGateway } from "@opencrane/state/persona/adapter";
import { OpenCraneProviderKeyGateway, PROVIDER_KEY_GATEWAY } from "@opencrane/state/provider-key/adapter";
import { OpenCraneSkillCatalogueGateway, SKILL_CATALOGUE_GATEWAY } from "@opencrane/state/skills/adapter";

/**
 * Binds the complete network profile used by development-live and production builds.
 *
 * Called by: the production gateway-profile entry point before any routed feature is loaded.
 * @returns Providers to spread into the root application configuration.
 */
export function provideOpenCraneUiLiveGateways(): Provider[]
{
	return [
		{ provide: SESSION_GATEWAY, useClass: OpenCraneSessionGateway },
		{ provide: PERSONA_GATEWAY, useClass: OpenCranePersonaGateway },
		{ provide: PERSONA_FIRST_CHAT_GATEWAY, useClass: OpenCranePersonaFirstChatGateway },
		{ provide: CONVERSATION_WORKSPACE_GATEWAY, useClass: OpenCraneConversationWorkspaceGateway },
		{ provide: CONVERSATION_WORKSPACE_EVENT_STREAM, useClass: OpenCraneConversationEventStream },
		{ provide: CONVERSATION_ASSETS_GATEWAY, useClass: OpenCraneConversationAssetsGateway },
		{ provide: ELICITATION_GATEWAY, useClass: OpenCraneConversationElicitationGateway },
		{ provide: AGENT_THREAD_GATEWAY, useClass: OpenCraneAgentThreadGateway },
		{ provide: ORGANIZATION_MEMBERS_GATEWAY, useClass: OpenCraneOrganizationMembersGateway },
		{ provide: MCP_GATEWAY, useClass: OpenCraneMcpGateway },
		{ provide: PROVIDER_KEY_GATEWAY, useClass: OpenCraneProviderKeyGateway },
		{ provide: PERSONAL_ASSETS_GATEWAY, useClass: OpenCranePersonalAssetsGateway },
		{ provide: SKILL_CATALOGUE_GATEWAY, useClass: OpenCraneSkillCatalogueGateway }
	];
}
