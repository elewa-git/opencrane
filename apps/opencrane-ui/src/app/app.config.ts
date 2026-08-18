import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from "@angular/core";
import { provideRouter, withComponentInputBinding } from "@angular/router";
import { provideAnimationsAsync } from "@angular/platform-browser/animations/async";
import { provideHttpClient, withFetch } from "@angular/common/http";
import { providePrimeNG } from "primeng/config";

import { OpenCranePreset } from "@opencrane/core";
import { AGENT_THREAD_GATEWAY, OpenCraneAgentThreadGateway } from "@opencrane/state/conversation/agent-threads";
import { PLATFORM_SURFACE } from "@opencrane/state/core";
import { provideControlPlaneGateways } from "@opencrane/state/gateways";
import { OpenCranePersonaFirstChatGateway, PERSONA_FIRST_CHAT_GATEWAY, PERSONA_GATEWAY } from "@opencrane/state/onboarding";
import { OpenCranePersonaGateway } from "@opencrane/state/persona/adapter";
import { ORGANIZATION_MEMBERS_GATEWAY } from "@opencrane/state/organization/members";
import { OpenCraneOrganizationMembersGateway } from "@opencrane/state/organization/members/adapter";
import { provideWebPlatform } from "@opencrane/platform";

import { APP_ROUTES } from "./app.routes";
import { provideConversationWorkspaceComposition } from "./conversation-workspace.providers";

/**
 * Root application configuration for the OpenCrane frontend.
 *
 * Change detection is zoneless: the app is fully signal-driven with OnPush
 * components, so zone.js is not bundled (see the empty polyfills in the build).
 * The web PlatformBridge is provided here; a desktop app swaps in its own.
 *
 * `withComponentInputBinding()` is load-bearing rather than decorative: route
 * parameters such as :conversationId reach a route component as a signal input
 * instead of the component reading ActivatedRoute, so a route component can stay
 * a thin coordinator. Removing it silently leaves those inputs undefined.
 *
 * Called by: `bootstrapApplication` in src/main.ts.
 */
export const appConfig: ApplicationConfig =
{
	providers:
	[
		provideBrowserGlobalErrorListeners(),
		provideZonelessChangeDetection(),
		provideRouter(APP_ROUTES, withComponentInputBinding()),
		provideHttpClient(withFetch()),
		provideAnimationsAsync(),
		providePrimeNG({ theme: { preset: OpenCranePreset } }),
		provideWebPlatform(),
		{ provide: PERSONA_GATEWAY, useClass: OpenCranePersonaGateway },
		{ provide: PERSONA_FIRST_CHAT_GATEWAY, useClass: OpenCranePersonaFirstChatGateway },
		{ provide: AGENT_THREAD_GATEWAY, useClass: OpenCraneAgentThreadGateway },
		{ provide: ORGANIZATION_MEMBERS_GATEWAY, useClass: OpenCraneOrganizationMembersGateway },
		// Chat gateways, the shared event stream, and A2UI are bound here rather than inside the
		// workspace feature — the app is the only layer allowed to name a concrete adapter. They sit at
		// the root because the chat routes are lazily loaded and must find these bindings already in
		// place.
		...provideConversationWorkspaceComposition(),
		// This app is the org/customer surface — capabilities derive from the
		// org-admin claim only (platform-operator claims grant nothing here).
		{ provide: PLATFORM_SURFACE, useValue: "org" },
		// Swappable data gateways are selected from one environment flag
		// (mock in dev, live in prod) — see provideControlPlaneGateways.
		...provideControlPlaneGateways()
	]
};
