import { InjectionToken } from "@angular/core";

import { PlatformBridge } from "./platform-bridge.types";

/** DI token for the active runtime's PlatformBridge implementation. */
export const PLATFORM_BRIDGE: InjectionToken<PlatformBridge> = new InjectionToken<PlatformBridge>("WO_PLATFORM_BRIDGE");
