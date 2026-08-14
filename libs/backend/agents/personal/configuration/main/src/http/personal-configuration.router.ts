import { Router } from "express";

import { _CreateDecidePersonalConfigurationChangeHandler } from "./decide-personal-configuration-change.handler";
import { _CreateListPersonalConfigurationChangesHandler } from "./list-personal-configuration-changes.handler";
import { _CreateMaterializePersonalConfigurationChangeHandler } from "./materialize-personal-configuration-change.handler";
import type { PersonalConfigurationRouterDependencies } from "./personal-configuration.router.types";

/**
 * Creates the three configuration-proposal routes, all requiring a browser session.
 *
 * `GET /changes` lists the user's own proposals, `POST /changes/:changeId/decision` records an
 * accept or reject, and `POST /changes/:changeId/materialize` applies an accepted one. The
 * proposal id in the path is the only value any route takes from the caller.
 *
 * Called by: {@link _CreatePersonalConfigurationRouter}.
 *
 * @param dependencies - Repositories, clock and logger. See {@link PersonalConfigurationRouterDependencies}.
 * @returns An Express router to mount under the caller's own prefix.
 */
export function __CreatePersonalConfigurationRouter(dependencies: PersonalConfigurationRouterDependencies): Router
{
	const router = Router();
	router.get("/changes", _CreateListPersonalConfigurationChangesHandler(dependencies));
	router.post("/changes/:changeId/decision", _CreateDecidePersonalConfigurationChangeHandler(dependencies));
	router.post("/changes/:changeId/materialize", _CreateMaterializePersonalConfigurationChangeHandler(dependencies));
	return router;
}
