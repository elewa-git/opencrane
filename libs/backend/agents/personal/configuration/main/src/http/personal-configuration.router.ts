import { Router } from "express";

import { _CreateDecidePersonalConfigurationChangeHandler } from "./decide-personal-configuration-change.handler.js";
import { _CreateListPersonalConfigurationChangesHandler } from "./list-personal-configuration-changes.handler.js";
import { _CreateMaterializePersonalConfigurationChangeHandler } from "./materialize-personal-configuration-change.handler.js";
import type { PersonalConfigurationRouterDependencies } from "./personal-configuration.router.types.js";

/** Create the browser-session-authenticated personal configuration proposal router. */
export function __CreatePersonalConfigurationRouter(dependencies: PersonalConfigurationRouterDependencies): Router
{
	const router = Router();
	router.get("/changes", _CreateListPersonalConfigurationChangesHandler(dependencies));
	router.post("/changes/:changeId/decision", _CreateDecidePersonalConfigurationChangeHandler(dependencies));
	router.post("/changes/:changeId/materialize", _CreateMaterializePersonalConfigurationChangeHandler(dependencies));
	return router;
}
