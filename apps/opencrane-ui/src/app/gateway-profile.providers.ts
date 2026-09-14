import type { Provider } from "@angular/core";

import { provideControlPlaneGateways } from "@opencrane/state/gateways";
import { OpenCranePersonaFirstChatGateway, PERSONA_FIRST_CHAT_GATEWAY, PERSONA_GATEWAY } from "@opencrane/state/onboarding";
import { OpenCranePersonaGateway } from "@opencrane/state/persona/adapter";
import { ORGANIZATION_MEMBERS_GATEWAY } from "@opencrane/state/organization/members";
import { OpenCraneOrganizationMembersGateway } from "@opencrane/state/organization/members/adapter";

import { provideConversationWorkspaceComposition } from "./conversation-workspace.providers";

/**
 * Provides the live gateway composition used by production and development-live builds.
 *
 * The default local build replaces this module at compile time, so importing the application root
 * does not force live and fixture adapters into the same bundle.
 *
 * Called by: `appConfig`, which spreads these bindings into the application root.
 */
export const OPENCRANE_UI_GATEWAY_PROVIDERS: Provider[] =
[
	{ provide: PERSONA_GATEWAY, useClass: OpenCranePersonaGateway },
	{ provide: PERSONA_FIRST_CHAT_GATEWAY, useClass: OpenCranePersonaFirstChatGateway },
	{ provide: ORGANIZATION_MEMBERS_GATEWAY, useClass: OpenCraneOrganizationMembersGateway },
	...provideConversationWorkspaceComposition(),
	...provideControlPlaneGateways()
];
