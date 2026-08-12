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
import { provideWebPlatform } from "@opencrane/platform";

import { APP_ROUTES } from "./app.routes";
import { provideConversationWorkspaceComposition } from "./chats/conversation-workspace.providers.js";

/**
 * Root application configuration for the OpenCrane frontend.
 *
 * Change detection is zoneless: the app is fully signal-driven with OnPush
 * components, so zone.js is not bundled (see the empty polyfills in the build).
 * The web PlatformBridge is provided here; a desktop app swaps in its own.
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
		...provideConversationWorkspaceComposition(),
		// This app is the org/customer surface — capabilities derive from the
		// org-admin claim only (platform-operator claims grant nothing here).
		{ provide: PLATFORM_SURFACE, useValue: "org" },
		// Swappable data gateways are selected from one environment flag
		// (mock in dev, live in prod) — see provideControlPlaneGateways.
		...provideControlPlaneGateways()
	]
};
