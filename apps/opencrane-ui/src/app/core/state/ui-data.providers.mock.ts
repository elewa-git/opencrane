import { EnvironmentProviders, Provider } from "@angular/core";

import { ___ProvideUiMocks } from "../mocks/provide-ui-mocks.js";

/** Explicit mock-build provider bindings replacing the production provider module. */
export const UI_DATA_PROVIDERS: readonly (Provider | EnvironmentProviders)[] = [___ProvideUiMocks()];
