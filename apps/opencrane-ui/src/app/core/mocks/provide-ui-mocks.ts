import { EnvironmentProviders, makeEnvironmentProviders } from "@angular/core";

import { UI_ACCESS_GUARD, UI_FIRST_RUN_GUARD, UI_SESSION_DATA_SOURCE, UI_SETTINGS_DATA_SOURCE } from "../state/ui-data-source.tokens.js";
import { ___MockAccessGuard } from "./mock-access.guard.js";
import { MockBudgetService } from "./mock-budget.service.js";
import { MockChannelService } from "./mock-channel.service.js";
import { MockClockService } from "./mock-clock.service.js";
import { MockCredentialService } from "./mock-credential.service.js";
import { MockDataNetworkService } from "./mock-data-network.service.js";
import { MockIdentityService } from "./mock-identity.service.js";
import { ___MockFirstRunGuard } from "./mock-first-run.guard.js";
import { MockOrganizationService } from "./mock-organization.service.js";
import { MockResetService } from "./mock-reset.service.js";
import { MockScenarioService } from "./mock-scenario.service.js";
import { MockSessionService } from "./mock-session.service.js";
import { MockSettingsService } from "./mock-settings.service.js";
import { MockSkillService } from "./mock-skill.service.js";

/** Registers every deterministic mock owner for the explicit UI handoff build. */
export function ___ProvideUiMocks(): EnvironmentProviders
{
	return makeEnvironmentProviders([
		MockScenarioService,
		MockClockService,
		MockIdentityService,
		MockSessionService,
		MockSettingsService,
		MockOrganizationService,
		MockBudgetService,
		MockSkillService,
		MockChannelService,
		MockDataNetworkService,
		MockCredentialService,
		MockResetService,
		{ provide: UI_SESSION_DATA_SOURCE, useExisting: MockSessionService },
		{ provide: UI_SETTINGS_DATA_SOURCE, useExisting: MockSettingsService },
		{ provide: UI_ACCESS_GUARD, useValue: ___MockAccessGuard },
		{ provide: UI_FIRST_RUN_GUARD, useValue: ___MockFirstRunGuard }
	]);
}
