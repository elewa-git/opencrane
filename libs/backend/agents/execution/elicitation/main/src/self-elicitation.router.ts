import { Router, type Request, type Response } from "express";

import { ElicitationBodyKinds, type ElicitationResponseValue, type SubmitElicitationResponse } from "@opencrane/contracts";

import type { SelfElicitationCaller, SelfElicitationRouterDependencies } from "./self-elicitation.router.types.js";

/** Create the sole browser read-and-response API for every elicitation body. */
export function __CreateSelfElicitationRouter(dependencies: SelfElicitationRouterDependencies): Router
{
	const router = Router();
	router.get("/:conversationId/elicitations/:requestId", async function _Read(request: Request, response: Response)
	{
		const caller = _RequireCaller(request, response, dependencies);
		const coordinates = _Coordinates(request);
		if (caller === null) return;
		if (coordinates === null) { _Respond(response, 400, "invalid_elicitation_coordinates"); return; }
		try
		{
			const elicitation = await dependencies.elicitations.readOwned(caller.siloId, coordinates.conversationId, coordinates.requestId, caller.subjectId, dependencies.clock.now());
			if (elicitation === null) { _Respond(response, 404, "elicitation_not_found"); return; }
			response.status(200).json({ elicitation });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "elicitation.read", siloId: caller.siloId }, "Elicitation read failed");
			_Respond(response, 503, "elicitation_read_unavailable");
		}
	});
	router.post("/:conversationId/elicitations/:requestId/responses", async function _RespondToRequest(request: Request, response: Response)
	{
		const caller = _RequireCaller(request, response, dependencies);
		const coordinates = _Coordinates(request);
		const submission = _Submission(request.body);
		if (caller === null) return;
		if (coordinates === null || submission === null) { _Respond(response, 400, "invalid_elicitation_response"); return; }
		try
		{
			const result = await dependencies.elicitations.respond({ siloId: caller.siloId, conversationId: coordinates.conversationId, requestId: coordinates.requestId, subjectId: caller.subjectId, verifiedStepUpAt: caller.verifiedStepUpAt, submission, now: dependencies.clock.now() });
			if (result.outcome === "accepted") { response.status(200).json({ response: result.projection }); return; }
			if (result.outcome === "invalid_response") { _Respond(response, 400, "invalid_elicitation_response"); return; }
			if (result.outcome === "step_up_required") { _Respond(response, 428, "elicitation_step_up_required"); return; }
			if (result.outcome === "expired" || result.outcome === "conflict") { _Respond(response, 409, `elicitation_${result.outcome}`); return; }
			if (result.outcome === "unauthorized") { _Respond(response, 403, "elicitation_response_forbidden"); return; }
			_Respond(response, 404, "elicitation_not_found");
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "elicitation.respond", siloId: caller.siloId }, "Elicitation response failed");
			_Respond(response, 503, "elicitation_response_unavailable");
		}
	});
	return router;
}

/** Resolve the authenticated self caller or emit a bounded denial. */
function _RequireCaller(request: Request, response: Response, dependencies: SelfElicitationRouterDependencies): SelfElicitationCaller | null
{
	const caller = dependencies.resolveCaller(request);
	if (caller === null) _Respond(response, 401, "elicitation_authentication_required");
	return caller;
}

/** Parse two non-empty path coordinates. */
function _Coordinates(request: Request): { readonly conversationId: string; readonly requestId: string } | null
{
	const conversationId = request.params["conversationId"];
	const requestId = request.params["requestId"];
	return typeof conversationId === "string" && conversationId.trim().length > 0 && typeof requestId === "string" && requestId.trim().length > 0 ? { conversationId, requestId } : null;
}

/** Parse the exact idempotent body without accepting authority coordinates. */
function _Submission(body: unknown): SubmitElicitationResponse | null
{
	if (!_Record(body) || !_ExactKeys(body, ["idempotencyKey", "response"]) || typeof body["idempotencyKey"] !== "string" || body["idempotencyKey"].trim().length === 0 || body["idempotencyKey"].length > 200) return null;
	const response = _ResponseValue(body["response"]);
	return response === null ? null : { idempotencyKey: body["idempotencyKey"], response };
}

/** Parse one exact discriminated response value. */
function _ResponseValue(value: unknown): ElicitationResponseValue | null
{
	if (!_Record(value) || typeof value["kind"] !== "string") return null;
	if (value["kind"] === ElicitationBodyKinds.Approval && _ExactKeys(value, ["kind", "approved"]) && typeof value["approved"] === "boolean") return { kind: value["kind"], approved: value["approved"] };
	if (value["kind"] === ElicitationBodyKinds.SingleChoice && _ExactKeys(value, ["kind", "selection"]) && typeof value["selection"] === "string") return { kind: value["kind"], selection: value["selection"] };
	if (value["kind"] === ElicitationBodyKinds.MultipleChoice && _ExactKeys(value, ["kind", "selections"]) && Array.isArray(value["selections"]) && value["selections"].every(_String)) return { kind: value["kind"], selections: value["selections"] };
	if (value["kind"] === ElicitationBodyKinds.FreeText && _ExactKeys(value, ["kind", "text"]) && typeof value["text"] === "string") return { kind: value["kind"], text: value["text"] };
	return null;
}

/** Whether an unknown array item is a string. */
function _String(value: unknown): value is string
{
	return typeof value === "string";
}

/** Whether an unknown value is a JSON-shaped record. */
function _Record(value: unknown): value is Record<string, unknown>
{
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Require an exact top-level key set. */
function _ExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean
{
	const actual = Object.keys(record);
	return actual.length === keys.length && keys.every(function _Includes(key) { return actual.includes(key); });
}

/** Write one bounded JSON error. */
function _Respond(response: Response, status: number, error: string): void
{
	response.status(status).json({ error });
}
