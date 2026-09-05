import type { Provider } from "@angular/core";

import { CONVERSATION_WORKSPACE_EVENT_STREAM, CONVERSATION_WORKSPACE_GATEWAY } from "@opencrane/state/conversation/workspace";
import { OpenCraneConversationWorkspaceGateway } from "@opencrane/state/conversation/workspace/adapter";
import { OpenCraneConversationEventStream } from "@opencrane/state/conversation/adapter";
import { CONVERSATION_ASSETS_GATEWAY, OpenCraneConversationAssetsGateway } from "@opencrane/state/conversation/assets";

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
 * The metadata gateway, Kurrent-history poller, and asset gateway remain separate ports so a host can
 * replace transport without moving authority into the feature.
 *
 * A desktop or test host that wanted different transports would call its own version of this
 * function; nothing in the feature would change.
 *
 * Called by: `appConfig` in `apps/opencrane-ui/src/app/app.config.ts`, spread into the root provider
 * list so the bindings exist for every lazily loaded chat route.
 *
 * @returns Providers to spread into the root `ApplicationConfig`.
 * @see CONVERSATION_WORKSPACE_GATEWAY
 * @see CONVERSATION_WORKSPACE_EVENT_STREAM
 * @see CONVERSATION_ASSETS_GATEWAY
 */
export function provideConversationWorkspaceComposition(): Provider[]
{
	return [
		OpenCraneConversationEventStream,
		{ provide: CONVERSATION_WORKSPACE_GATEWAY, useClass: OpenCraneConversationWorkspaceGateway },
		// The poller remains shared by direct, group, and Agent-session conversations so every mode
		// resumes immutable history from the same server-owned position contract.
		{ provide: CONVERSATION_WORKSPACE_EVENT_STREAM, useExisting: OpenCraneConversationEventStream },
		{ provide: CONVERSATION_ASSETS_GATEWAY, useClass: OpenCraneConversationAssetsGateway }
	];
}
