import { InjectionToken } from "@angular/core";

import { LocalDevelopmentScenarioKinds } from "./local-development-scenario.types";

/** Lets focused tests override the URL-derived scenario for one injector. */
export const LOCAL_DEVELOPMENT_SCENARIO = new InjectionToken<LocalDevelopmentScenarioKinds>("LOCAL_DEVELOPMENT_SCENARIO", {
	factory: _ScenarioFromLocation
});

/** Converts the URL query value to an allowlisted scenario. */
function _ScenarioFromLocation(): LocalDevelopmentScenarioKinds
{
	if (typeof globalThis.location === "undefined")
	{
		return LocalDevelopmentScenarioKinds.HappyPath;
	}

	const candidate = new URLSearchParams(globalThis.location.search).get("mockScenario");
	return Object.values(LocalDevelopmentScenarioKinds).includes(candidate as LocalDevelopmentScenarioKinds)
		? candidate as LocalDevelopmentScenarioKinds
		: LocalDevelopmentScenarioKinds.HappyPath;
}
