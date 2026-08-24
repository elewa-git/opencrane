import type { EnvironmentProviders, Provider } from "@angular/core";

import { provideOpenCraneA2ui } from "@opencrane/elements/a2ui";
import { CONVERSATION_WORKSPACE_EVENT_STREAM, CONVERSATION_WORKSPACE_GATEWAY } from "@opencrane/state/conversation/workspace";
import { OpenCraneConversationWorkspaceGateway } from "@opencrane/state/conversation/workspace/adapter";
import { OpenCraneConversationEventStream } from "@opencrane/state/conversation/adapter";
import { CONVERSATION_ASSETS_GATEWAY, OpenCraneConversationAssetsGateway } from "@opencrane/state/conversation/assets";
import { toSanitizedMarkdownHtml } from "@opencrane/state/conversation/render";

/**
 * Bind the chat feature's typed ports to this web application's concrete adapters.
 *
 * The workspace feature and its state package are written against injection tokens and never name a
 * transport, so on their own they cannot run. This function is the one place that says which
 * implementation each token gets, and it lives in the app because the app is the layer allowed to
 * know about transport: `docs/agents/app-specific.md` keeps feature packages on presentation, state
 * packages on ports, and only a state adapter package on browser transport, and
 * `docs/agents/app-source-allowlist.json` classifies this file as `browser-composition` for exactly
 * that reason. Adding an adapter import to the feature instead of here would break that direction.
 *
 * Three of the four bindings are gateways the workspace store reads and commands through. The fourth
 * is A2UI, which is set up rather than merely bound: {@link provideOpenCraneA2ui} is handed the
 * Markdown sanitiser so that agent-authored Markdown is cleaned by the app's own renderer before it
 * reaches the DOM, instead of each A2UI surface choosing for itself.
 *
 * A desktop or test host that wanted different transports would call its own version of this
 * function; nothing in the feature would change.
 *
 * Called by: `appConfig` in `apps/opencrane-ui/src/app/app.config.ts`, spread into the root provider
 * list so the bindings exist for every lazily loaded chat route.
 *
 * @returns Providers to spread into an `ApplicationConfig`. `EnvironmentProviders` appears in the
 * union because `provideOpenCraneA2ui` returns Angular's own environment providers, which cannot be
 * declared as a plain `Provider`.
 * @see CONVERSATION_WORKSPACE_GATEWAY
 * @see CONVERSATION_WORKSPACE_EVENT_STREAM
 * @see CONVERSATION_ASSETS_GATEWAY
 */
export function provideConversationWorkspaceComposition(): (Provider | EnvironmentProviders)[]
{
	return [
		OpenCraneConversationEventStream,
		{ provide: CONVERSATION_WORKSPACE_GATEWAY, useClass: OpenCraneConversationWorkspaceGateway },
		// The stream comes from the shared conversation adapter rather than a workspace-specific one:
		// direct, group, and Agent-session conversations all read the same event stream, and
		// docs/agents/app-specific.md keeps that as one implementation instead of a second copy.
		{ provide: CONVERSATION_WORKSPACE_EVENT_STREAM, useExisting: OpenCraneConversationEventStream },
		{ provide: CONVERSATION_ASSETS_GATEWAY, useClass: OpenCraneConversationAssetsGateway },
		...provideOpenCraneA2ui(toSanitizedMarkdownHtml)
	];
}
