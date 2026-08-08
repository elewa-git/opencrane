import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from "@angular/core";
import { provideRouter, withComponentInputBinding } from "@angular/router";
import { provideAnimationsAsync } from "@angular/platform-browser/animations/async";
import { provideHttpClient, withFetch } from "@angular/common/http";
import { providePrimeNG } from "primeng/config";

import { OpenCranePreset } from "@opencrane/core";
import { PLATFORM_SURFACE } from "@opencrane/state/core";
import { provideControlPlaneGateways } from "@opencrane/state/gateways";
import { PERSONA_GATEWAY } from "@opencrane/state/onboarding";
import { OpenCranePersonaGateway } from "@opencrane/state/persona/adapter";
import { provideWebPlatform } from "@opencrane/platform";

import { APP_ROUTES } from "./app.routes";

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
		// This app is the org/customer surface — capabilities derive from the
		// org-admin claim only (platform-operator claims grant nothing here).
		{ provide: PLATFORM_SURFACE, useValue: "org" },
		// Swappable data gateways are selected from one environment flag
		// (mock in dev, live in prod) — see provideControlPlaneGateways.
		...provideControlPlaneGateways()
	]
};
