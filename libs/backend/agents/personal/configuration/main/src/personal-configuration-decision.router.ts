import { Router, type Request, type Response } from "express";

import { __DecidePersonalConfigurationChange } from "./personal-configuration-decision.js";
import type { PersonalConfigurationDecisionCaller, PersonalConfigurationDecisionRouterDependencies } from "./personal-configuration-decision.router.types.js";

/** Build the public owner-only API for accepting or rejecting a future-session proposal. */
export function __CreatePersonalConfigurationDecisionRouter(dependencies: PersonalConfigurationDecisionRouterDependencies): Router
{
	const router = Router();
	router.post("/personal-configuration-changes/:changeId/decision", async function _Decide(request: Request, response: Response): Promise<void>
	{
		const caller = await _Caller(dependencies, request, response);
		if (!caller) return;
		const changeId = request.params["changeId"];
		const decision = _Decision(request.body);
		if (!_Identifier(changeId) || decision === null)
		{
			_Problem(response, 400, "invalid_personal_configuration_decision");
			return;
		}
		try
		{
			const result = await __DecidePersonalConfigurationChange(dependencies.decisions, { siloId: caller.siloId, userId: caller.userId, changeId, decision: decision.decision, rejectionReason: decision.rejectionReason, decidedAt: dependencies.clock.now().toISOString() });
			if (result.outcome === "denied")
			{
				_Denial(response, result.reason);
				return;
			}
			response.status(200).json({ decision: result.outcome });
		}
		catch (err)
		{
			_Failed(dependencies, err, "personal_configuration.decide");
			_Problem(response, 503, "personal_configuration_authority_unavailable");
		}
	});
	return router;
}

/** Resolve the active personal owner without conflating missing membership with an unavailable authority. */
async function _Caller(dependencies: PersonalConfigurationDecisionRouterDependencies, request: Request, response: Response): Promise<PersonalConfigurationDecisionCaller | null>
{
	try
	{
		const caller = await dependencies.resolveCaller(request);
		if (caller) return caller;
		_Problem(response, 401, "personal_configuration_identity_denied");
		return null;
	}
	catch (err)
	{
		_Failed(dependencies, err, "personal_configuration.resolve_caller");
		_Problem(response, 503, "personal_configuration_membership_unavailable");
		return null;
	}
}

/** Parse exactly one accepted decision or one rejected decision with a bounded explanatory reason. */
function _Decision(value: unknown): { readonly decision: "accepted" | "rejected"; readonly rejectionReason: string | null } | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
	const body = value as Record<string, unknown>;
	if (body["decision"] === "accepted" && _ExactKeys(body, ["decision"])) return { decision: "accepted", rejectionReason: null };
	if (body["decision"] === "rejected" && _ExactKeys(body, ["decision", "rejectionReason"]) && _Reason(body["rejectionReason"])) return { decision: "rejected", rejectionReason: body["rejectionReason"] };
	return null;
}

/** Require an exact request shape so browser input cannot evolve into an authority-bearing payload. */
function _ExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean
{
	return Object.keys(value).length === keys.length && keys.every(function _HasKey(key): boolean { return key in value; });
}

/** Validate the bounded user-facing explanation required for a rejection. */
function _Reason(value: unknown): value is string
{
	return typeof value === "string" && value.trim().length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(value);
}

/** Validate opaque change identifiers without interpreting or accepting arbitrary control characters. */
function _Identifier(value: unknown): value is string
{
	return typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(value);
}

/** Map domain denials to stable HTTP outcomes without disclosing a foreign owner's record. */
function _Denial(response: Response, reason: string): void
{
	const status = reason === "invalid_command" ? 400 : reason === "not_found_or_not_owner" ? 404 : reason === "already_decided" ? 409 : 503;
	_Problem(response, status, `personal_configuration_${reason}`);
}

/** Emit the standard bounded error envelope for this public route. */
function _Problem(response: Response, status: number, code: string): void
{
	response.status(status).json({ error: "Personal configuration decision could not be completed.", code });
}

/** Log only route operation and error metadata, never the requested patch or user-supplied reason. */
function _Failed(dependencies: PersonalConfigurationDecisionRouterDependencies, err: unknown, operation: string): void
{
	dependencies.logger.error({ err, operation }, "Personal configuration decision authority failed");
}
