import type { Request, RequestHandler, Response } from "express";

import { __DecidePersonalConfigurationChange } from "../decision/personal-configuration-decision.js";
import { PersonalConfigurationDecisionCodes } from "../decision/personal-configuration-decision.types.js";
import { PersonalConfigurationHttpErrors, type PersonalConfigurationRouterDependencies } from "./personal-configuration.router.types.js";

/** Validated owner decision body accepted by the HTTP boundary. */
interface PersonalConfigurationDecisionBody
{
	/** Explicit owner decision. */
	readonly decision: PersonalConfigurationDecisionCodes.Accepted | PersonalConfigurationDecisionCodes.Rejected;
	/** Rejection explanation, or null for acceptance. */
	readonly rejectionReason: string | null;
}

/**
 * Creates the route where a user accepts or rejects one of their own proposals.
 *
 * The server supplies the silo, the user and the decision time; the body may say only
 * `{ decision: "accepted" }` or `{ decision: "rejected", rejectionReason }`, and any extra field
 * makes it a 400. The decision authority does the compare-and-set.
 *
 * A missing proposal and an already-decided one both return 404, so a caller cannot learn
 * whether another user has a proposal with that id. Recording a decision applies nothing: a 200
 * means consent was recorded, not that the agent changed.
 *
 * Called by: {@link __CreatePersonalConfigurationRouter}.
 *
 * @param dependencies - Repositories, clock and logger.
 * @returns An Express handler answering 200, 400, 401, 404 or 503.
 */
export function _CreateDecidePersonalConfigurationChangeHandler(dependencies: PersonalConfigurationRouterDependencies): RequestHandler
{
	return async function _DecidePersonalConfigurationChange(request: Request, response: Response): Promise<void>
	{
		// 1. Work out who is calling, and check the two values they control: the id and the decision.
		const caller = dependencies.resolveCaller(request);
		const changeId = request.params["changeId"];
		const decision = _decision(request.body);
		if (caller === null) { response.status(401).json({ error: PersonalConfigurationHttpErrors.AuthenticationRequired }); return; }
		if (typeof changeId !== "string" || changeId.trim().length === 0 || decision === null) { response.status(400).json({ error: PersonalConfigurationHttpErrors.InvalidDecision }); return; }

		try
		{
			// 2. Let the decision authority change the state, using the server's owner ids and clock.
			const result = await __DecidePersonalConfigurationChange(dependencies.decisions, { siloId: caller.siloId, userId: caller.userId, changeId, decision: decision.decision, rejectionReason: decision.rejectionReason, decidedAt: dependencies.clock.now().toISOString() });
			if (result.outcome !== PersonalConfigurationDecisionCodes.Denied) { response.status(200).json({ changeId, state: result.outcome }); return; }

			// 3. Map denials to status codes without revealing who owns the proposal or what the database said.
			if (result.reason === PersonalConfigurationDecisionCodes.NotFoundOrNotOwner || result.reason === PersonalConfigurationDecisionCodes.AlreadyDecided) { response.status(404).json({ error: PersonalConfigurationHttpErrors.ChangeNotFound }); return; }
			if (result.reason === PersonalConfigurationDecisionCodes.PersistenceUnavailable) { response.status(503).json({ error: PersonalConfigurationHttpErrors.DecisionUnavailable }); return; }
			response.status(400).json({ error: PersonalConfigurationHttpErrors.InvalidDecision });
		}
		catch (error)
		{
			dependencies.logger.error({ err: error, operation: "personal_configuration.decide", siloId: caller.siloId }, "Personal configuration decision failed");
			response.status(503).json({ error: PersonalConfigurationHttpErrors.DecisionUnavailable });
		}
	};
}

/** Returns the decision from the body, or null; any extra field makes the body invalid. */
function _decision(body: unknown): PersonalConfigurationDecisionBody | null
{
	if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
	const values = body as Record<string, unknown>;
	if (values.decision === PersonalConfigurationDecisionCodes.Accepted && Object.keys(values).length === 1) return { decision: PersonalConfigurationDecisionCodes.Accepted, rejectionReason: null };
	if (values.decision === PersonalConfigurationDecisionCodes.Rejected && typeof values.rejectionReason === "string" && Object.keys(values).length === 2) return { decision: PersonalConfigurationDecisionCodes.Rejected, rejectionReason: values.rejectionReason };
	return null;
}
