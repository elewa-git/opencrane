import { Router, type Request, type Response } from "express";

import { __DecidePersonalConfigurationChange } from "./personal-configuration-decision.js";
import type { PersonalConfigurationCaller, PersonalConfigurationRouterDependencies } from "./personal-configuration.router.types.js";

/** Create the session-authenticated self-only decision API for future personal configuration changes. */
export function __CreatePersonalConfigurationRouter(dependencies: PersonalConfigurationRouterDependencies): Router
{
	const router = Router();

	router.post("/changes/:changeId/decision", async function _decide(request: Request, response: Response)
	{
		const caller = _requireCaller(request, response, dependencies);
		const changeId = request.params["changeId"];
		if (caller === null) return;
		if (typeof changeId !== "string" || !_isDecisionBody(request.body))
		{
			_respond(response, 400, "invalid_personal_configuration_decision");
			return;
		}

		try
		{
			// 1. Bind the state transition to the session-derived owner and silo, never body coordinates.
			const result = await __DecidePersonalConfigurationChange(dependencies.changes, { siloId: caller.siloId, userId: caller.userId, changeId, decision: request.body.decision, rejectionReason: request.body.decision === "rejected" ? request.body.rejectionReason : null, decidedAt: dependencies.clock.now().toISOString() });
			if (result.outcome === "denied")
			{
				_respond(response, _denialStatus(result.reason), result.reason);
				return;
			}

			// 2. Return only the new state; a separate reviewed flow materializes a later immutable snapshot.
			response.status(200).json({ changeId, state: result.outcome });
		}
		catch (err)
		{
			// 3. Keep persistence details out of the self-service response while retaining safe diagnosis data.
			dependencies.logger.error({ err, operation: "personal_configuration.decision", siloId: caller.siloId, changeId }, "Personal configuration decision failed");
			_respond(response, 503, "personal_configuration_unavailable");
		}
	});

	return router;
}

/** Resolve the session-derived caller or write the shared non-disclosing authentication denial. */
function _requireCaller(request: Request, response: Response, dependencies: PersonalConfigurationRouterDependencies): PersonalConfigurationCaller | null
{
	const caller = dependencies.resolveCaller(request);
	if (caller === null) _respond(response, 401, "personal_configuration_authentication_required");
	return caller;
}

/** Parse precisely the two supported owner decisions without accepting caller-selected lifecycle fields. */
function _isDecisionBody(value: unknown): value is { readonly decision: "accepted"; readonly rejectionReason?: never } | { readonly decision: "rejected"; readonly rejectionReason: string }
{
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const body = value as Record<string, unknown>;
	if (body["decision"] === "accepted") return Object.keys(body).length === 1;
	return body["decision"] === "rejected" && Object.keys(body).length === 2 && typeof body["rejectionReason"] === "string" && body["rejectionReason"].trim().length > 0;
}

/** Map a fail-closed authority denial to a bounded public HTTP status. */
function _denialStatus(reason: string): number
{
	if (reason === "persistence_unavailable") return 503;
	if (reason === "not_found_or_not_owner") return 404;
	if (reason === "already_decided") return 409;
	return 400;
}

/** Write one compact machine-readable problem response. */
function _respond(response: Response, status: number, error: string): void
{
	response.status(status).json({ error });
}
