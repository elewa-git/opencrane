import { Router, type Request, type Response } from "express";

import { ___DoWithTrace } from "@opencrane/backend/observability";
import type { JsonValue } from "@opencrane/util";

import { DeferredToolDecisionKinds } from "./deferred-tool-approval.types.js";
import type { DeferredToolApprovalCaller, DeferredToolApprovalRouterDependencies } from "./deferred-tool-approval.router.types.js";

type ParsedDecision =
	| { readonly decision: DeferredToolDecisionKinds.Approved; readonly arguments: JsonValue }
	| { readonly decision: DeferredToolDecisionKinds.Denied };

/** Create the browser-session-authenticated, self-only deferred-tool approval router. */
export function __CreateDeferredToolApprovalRouter(dependencies: DeferredToolApprovalRouterDependencies): Router
{
	const router = Router();

	router.get("/", async function _list(request: Request, response: Response)
	{
		const caller = _requireCaller(request, response, dependencies);
		if (caller === null) return;
		try
		{
			const approvals = await ___DoWithTrace("approval.list", { siloId: caller.siloId, subjectId: caller.subjectId }, function _traceList()
			{
				return dependencies.pendingApprovals.listPendingOwned(caller.siloId, caller.subjectId, dependencies.clock.now());
			});
			response.status(200).json({ approvals });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "deferred_tool_approval.list", siloId: caller.siloId }, "Deferred tool approval list failed");
			_respond(response, 503, "approval_list_unavailable");
		}
	});

	router.get("/:approvalRequestId", async function _read(request: Request, response: Response)
	{
		const caller = _requireCaller(request, response, dependencies);
		const approvalRequestId = request.params["approvalRequestId"];
		if (caller === null) return;
		if (typeof approvalRequestId !== "string" || !_isNonEmptyString(approvalRequestId)) { _respond(response, 400, "invalid_approval_request_id"); return; }
		try
		{
			const approval = await ___DoWithTrace("approval.read", { siloId: caller.siloId, subjectId: caller.subjectId }, function _traceRead()
			{
				return dependencies.pendingApprovals.readOwned(approvalRequestId, caller.siloId, caller.subjectId, dependencies.clock.now());
			});
			if (approval === null) { _respond(response, 404, "approval_not_found"); return; }
			response.status(200).json({ approval });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "deferred_tool_approval.read", siloId: caller.siloId }, "Deferred tool approval read failed");
			_respond(response, 503, "approval_read_unavailable");
		}
	});

	router.post("/:approvalRequestId/decision", async function _decide(request: Request, response: Response)
	{
		const caller = _requireCaller(request, response, dependencies);
		const approvalRequestId = request.params["approvalRequestId"];
		const decision = _decision(request.body);
		if (caller === null) return;
		if (typeof approvalRequestId !== "string" || !_isNonEmptyString(approvalRequestId) || decision === null) { _respond(response, 400, "invalid_approval_decision"); return; }

		try
		{
			const result = await ___DoWithTrace("approval.decide", { siloId: caller.siloId, subjectId: caller.subjectId }, function _traceDecide()
			{
				return dependencies.decisions.decideAtomically({
					approvalRequestId,
					siloId: caller.siloId,
					subjectId: caller.subjectId,
					decision: decision.decision,
					arguments: decision.decision === DeferredToolDecisionKinds.Approved ? decision.arguments : undefined,
					decidedBy: caller.subjectId,
					now: dependencies.clock.now(),
				});
			});
			if (result.outcome === "approved" || (result.outcome === "already_decided" && result.decision === "approved")) { response.status(200).json({ approvalRequestId, state: "approved" }); return; }
			if (result.outcome === "denied" || (result.outcome === "already_decided" && result.decision === "denied")) { response.status(200).json({ approvalRequestId, state: "denied" }); return; }
			if (result.outcome === "expired") { _respond(response, 409, "approval_expired"); return; }
			if (result.outcome === "invalid_arguments") { _respond(response, 400, "invalid_approval_arguments"); return; }
			_respond(response, 404, "approval_not_found");
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "deferred_tool_approval.decide", siloId: caller.siloId }, "Deferred tool approval decision failed");
			_respond(response, 503, "approval_decision_unavailable");
		}
	});

	return router;
}

/** Resolve one session-derived caller or write a non-disclosing authentication denial. */
function _requireCaller(request: Request, response: Response, dependencies: DeferredToolApprovalRouterDependencies): DeferredToolApprovalCaller | null
{
	const caller = dependencies.resolveCaller(request);
	if (caller === null) _respond(response, 401, "approval_authentication_required");
	return caller;
}

/** Accept only the exact body shape used by the approval-decision contract. */
function _decision(body: unknown): ParsedDecision | null
{
	if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
	const record = body as Record<string, unknown>;
	const decision = record["decision"];
	if (decision === DeferredToolDecisionKinds.Denied) return Object.keys(record).length === 1 ? { decision } : null;
	if (decision !== DeferredToolDecisionKinds.Approved || Object.keys(record).length !== 2) return null;
	const argumentsValue = record["arguments"];
	if (argumentsValue === null || typeof argumentsValue !== "object" || Array.isArray(argumentsValue)) return null;
	return { decision, arguments: argumentsValue as JsonValue };
}

/** Return whether one path or header coordinate contains a non-empty identifier. */
function _isNonEmptyString(value: string): boolean
{
	return value.trim().length > 0;
}

/** Write one bounded JSON problem response. */
function _respond(response: Response, status: number, error: string): void
{
	response.status(status).json({ error });
}
