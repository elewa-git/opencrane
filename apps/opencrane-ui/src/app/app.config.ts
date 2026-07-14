import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from "@angular/core";
import { provideRouter, withComponentInputBinding } from "@angular/router";
import { provideAnimationsAsync } from "@angular/platform-browser/animations/async";
import { provideHttpClient, withFetch } from "@angular/common/http";
import { providePrimeNG } from "primeng/config";

import { CONVERSATION_CACHE, PLATFORM_SURFACE } from "@opencrane/state/core";
import { IndexedDbConversationCache } from "@opencrane/state/conversation/cache";
import { UserTenantStore } from "@opencrane/state/tenant/adapter";
import { LOCAL_STORAGE_GATEWAY, SESSION_STORAGE_GATEWAY, WebLocalStorageAdapter, WebSessionStorageAdapter } from "@opencrane/state/utils/storage";
import { provideControlPlaneGateways } from "@opencrane/state/gateways";
import { provideWebPlatform } from "@opencrane/platform";

import { APP_ROUTES } from "./app.routes.js";
import { UI_DATA_PROVIDERS } from "./core/state/ui-data.providers.js";
import { OpenCranePreset } from "./core/theme/opencrane-preset.js";

/**
 * Root application configuration for the WeOwnAI frontend.
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
		...UI_DATA_PROVIDERS,
		provideWebPlatform(),
		{ provide: LOCAL_STORAGE_GATEWAY, useClass: WebLocalStorageAdapter },
		{ provide: SESSION_STORAGE_GATEWAY, useClass: WebSessionStorageAdapter },
		// This app is the org/customer surface — capabilities derive from the
		// org-admin claim only (platform-operator claims grant nothing here).
		{ provide: PLATFORM_SURFACE, useValue: "org" },
		// Swappable data gateways are selected from one environment flag
		// (mock in dev, live in prod) — see provideControlPlaneGateways.
		...provideControlPlaneGateways(),
		// Web local-transcript cache; a desktop build binds this token to a
		// filesystem/SQLite store instead (see ConversationCache).
		{ provide: CONVERSATION_CACHE, useClass: IndexedDbConversationCache },
		// UserTenant store for the customer-admin console (not a gateway).
		UserTenantStore
	]
};
