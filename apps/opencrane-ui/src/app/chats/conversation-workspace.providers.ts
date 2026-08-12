import type { EnvironmentProviders, Provider } from "@angular/core";

import { provideOpenCraneA2ui } from "@opencrane/elements/a2ui";
import { CONVERSATION_WORKSPACE_EVENT_STREAM, CONVERSATION_WORKSPACE_GATEWAY } from "@opencrane/state/conversation/workspace";
import { OpenCraneConversationWorkspaceGateway } from "@opencrane/state/conversation/workspace/adapter";
import { OpenCraneConversationEventStream } from "@opencrane/state/conversation/adapter";
import { CONVERSATION_ASSETS_GATEWAY, OpenCraneConversationAssetsGateway } from "@opencrane/state/conversation/assets";
import { toSanitizedMarkdownHtml } from "@opencrane/state/conversation/render";

/** Bind the chat feature's typed ports to this web application's concrete adapters. */
export function provideConversationWorkspaceComposition(): (Provider | EnvironmentProviders)[]
{
	return [
		{ provide: CONVERSATION_WORKSPACE_GATEWAY, useClass: OpenCraneConversationWorkspaceGateway },
		{ provide: CONVERSATION_WORKSPACE_EVENT_STREAM, useClass: OpenCraneConversationEventStream },
		{ provide: CONVERSATION_ASSETS_GATEWAY, useClass: OpenCraneConversationAssetsGateway },
		...provideOpenCraneA2ui(toSanitizedMarkdownHtml)
	];
}
