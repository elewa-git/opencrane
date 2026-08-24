import { InjectionToken } from "@angular/core";

import type { PlatformPreferenceStore } from "./platform-preference-store.types";

/** Selects the runtime-owned preference store supplied by the active application shell. */
export const PLATFORM_PREFERENCE_STORE = new InjectionToken<PlatformPreferenceStore>("PLATFORM_PREFERENCE_STORE");
