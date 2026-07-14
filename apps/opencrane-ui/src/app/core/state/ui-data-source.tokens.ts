import { InjectionToken } from "@angular/core";
import { CanActivateFn } from "@angular/router";

import { UiSessionDataSource } from "./session-data-source.types.js";
import { UiSettingsDataSource } from "./settings-data-source.types.js";

/** Swappable provider boundary for all Workspace and Session UI state. */
export const UI_SESSION_DATA_SOURCE = new InjectionToken<UiSessionDataSource>("UI_SESSION_DATA_SOURCE");

/** Swappable provider boundary for all Settings UI state. */
export const UI_SETTINGS_DATA_SOURCE = new InjectionToken<UiSettingsDataSource>("UI_SETTINGS_DATA_SOURCE");

/** Swappable provider boundary for authenticated tenant route access. */
export const UI_ACCESS_GUARD = new InjectionToken<CanActivateFn>("UI_ACCESS_GUARD");

/** Swappable provider boundary for first-run route access. */
export const UI_FIRST_RUN_GUARD = new InjectionToken<CanActivateFn>("UI_FIRST_RUN_GUARD");
