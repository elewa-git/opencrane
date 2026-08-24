import type { ClassProvider, InjectionToken, Provider, Type } from "@angular/core";
import { describe, expect, it } from "vitest";

import { OpenCranePersonalAssetsGateway, PERSONAL_ASSETS_GATEWAY } from "@opencrane/state/assets/adapter";
import { AGENT_THREAD_GATEWAY, OpenCraneAgentThreadGateway } from "@opencrane/state/conversation/agent-threads";
import { CONVERSATION_ASSETS_GATEWAY, OpenCraneConversationAssetsGateway } from "@opencrane/state/conversation/assets";
import { OpenCraneConversationEventStream } from "@opencrane/state/conversation/adapter";
import { ELICITATION_GATEWAY, OpenCraneConversationElicitationGateway } from "@opencrane/state/conversation/elicitation";
import { CONVERSATION_WORKSPACE_EVENT_STREAM, CONVERSATION_WORKSPACE_GATEWAY } from "@opencrane/state/conversation/workspace";
import { OpenCraneConversationWorkspaceGateway } from "@opencrane/state/conversation/workspace/adapter";
import { SESSION_GATEWAY } from "@opencrane/state/core";
import { OpenCraneSessionGateway } from "@opencrane/state/core/adapter";
import { MCP_GATEWAY, OpenCraneMcpGateway } from "@opencrane/state/mcp/adapter";
import { OpenCranePersonaFirstChatGateway, PERSONA_FIRST_CHAT_GATEWAY, PERSONA_GATEWAY } from "@opencrane/state/onboarding";
import { ORGANIZATION_MEMBERS_GATEWAY } from "@opencrane/state/organization/members";
import { OpenCraneOrganizationMembersGateway } from "@opencrane/state/organization/members/adapter";
import { OpenCranePersonaGateway } from "@opencrane/state/persona/adapter";
import { OpenCraneProviderKeyGateway, PROVIDER_KEY_GATEWAY } from "@opencrane/state/provider-key/adapter";
import { OpenCraneSkillCatalogueGateway, SKILL_CATALOGUE_GATEWAY } from "@opencrane/state/skills/adapter";

import { provideOpenCraneUiLiveGateways } from "../opencrane-ui-gateway-profile.provider";

/** Read one class binding from an application-profile provider list. */
function _ClassFor(providers: Provider[], token: InjectionToken<unknown> | Type<unknown>): unknown
{
	const match = providers.find(function _Matches(provider): provider is ClassProvider { return typeof provider === "object" && provider !== null && "provide" in provider && provider.provide === token; });
	return match?.useClass;
}

describe("provideOpenCraneUiLiveGateways", function _Suite()
{
	it("binds the live generated-client implementations in live mode", function _LiveProfile()
	{
		const providers = provideOpenCraneUiLiveGateways();

		expect(_ClassFor(providers, SESSION_GATEWAY)).toBe(OpenCraneSessionGateway);
		expect(_ClassFor(providers, PERSONA_GATEWAY)).toBe(OpenCranePersonaGateway);
		expect(_ClassFor(providers, PERSONA_FIRST_CHAT_GATEWAY)).toBe(OpenCranePersonaFirstChatGateway);
		expect(_ClassFor(providers, CONVERSATION_WORKSPACE_GATEWAY)).toBe(OpenCraneConversationWorkspaceGateway);
		expect(_ClassFor(providers, CONVERSATION_WORKSPACE_EVENT_STREAM)).toBe(OpenCraneConversationEventStream);
		expect(_ClassFor(providers, CONVERSATION_ASSETS_GATEWAY)).toBe(OpenCraneConversationAssetsGateway);
		expect(_ClassFor(providers, ELICITATION_GATEWAY)).toBe(OpenCraneConversationElicitationGateway);
		expect(_ClassFor(providers, AGENT_THREAD_GATEWAY)).toBe(OpenCraneAgentThreadGateway);
		expect(_ClassFor(providers, ORGANIZATION_MEMBERS_GATEWAY)).toBe(OpenCraneOrganizationMembersGateway);
		expect(_ClassFor(providers, MCP_GATEWAY)).toBe(OpenCraneMcpGateway);
		expect(_ClassFor(providers, PROVIDER_KEY_GATEWAY)).toBe(OpenCraneProviderKeyGateway);
		expect(_ClassFor(providers, PERSONAL_ASSETS_GATEWAY)).toBe(OpenCranePersonalAssetsGateway);
		expect(_ClassFor(providers, SKILL_CATALOGUE_GATEWAY)).toBe(OpenCraneSkillCatalogueGateway);
	});
});
