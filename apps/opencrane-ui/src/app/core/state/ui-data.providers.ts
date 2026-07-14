import { EnvironmentProviders, Provider } from "@angular/core";

import { ___FirstRunGuard } from "../../first-run.guard.js";
import { ___OperatorAccessGuard } from "../../operator-access.guard.js";
import { UI_ACCESS_GUARD, UI_FIRST_RUN_GUARD } from "./ui-data-source.tokens.js";

/** Production UI provider bindings; data-source tokens are supplied by future live adapters. */
export const UI_DATA_PROVIDERS: readonly (Provider | EnvironmentProviders)[] =
[
	{ provide: UI_ACCESS_GUARD, useValue: ___OperatorAccessGuard },
	{ provide: UI_FIRST_RUN_GUARD, useValue: ___FirstRunGuard }
];
