import { randomUUID } from "node:crypto";

import { Router, type Request, type Response } from "express";

import { __DigestCanonicalJson } from "./canonical-json-digest.js";
import type { DeferredToolDecision } from "./deferred-tool-approval.types.js";
import type { DeferredToolApprovalCaller, DeferredToolApprovalRouterDependencies } from "./deferred-tool-approval.router.types.js";

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
			const approvals = await dependencies.pendingApprovals.listPendingOwned(caller.siloId, caller.subjectId, dependencies.clock.now());
			response.status(200).json({ approvals });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "deferred_tool_approval.list", siloId: caller.siloId }, "Deferred tool approval list failed");
			_respond(response, 503, "approval_list_unavailable");
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
			const result = await dependencies.decisions.decideAtomically({
				approvalRequestId,
				siloId: caller.siloId,
				subjectId: caller.subjectId,
				decision,
				decidedBy: caller.subjectId,
				now: dependencies.clock.now(),
				resumeTokenHash: decision === "approved" ? _resumeTokenHash(approvalRequestId) : undefined,
				deferredToolResult: decision === "approved" ? { approvalRequestId, decision: "approved" } : undefined,
			});
			if (result.outcome === "approved" || (result.outcome === "already_decided" && result.decision === "approved")) { response.status(200).json({ approvalRequestId, state: "approved" }); return; }
			if (result.outcome === "denied" || (result.outcome === "already_decided" && result.decision === "denied")) { response.status(200).json({ approvalRequestId, state: "denied" }); return; }
			if (result.outcome === "expired") { _respond(response, 409, "approval_expired"); return; }
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
function _decision(body: unknown): DeferredToolDecision | null
{
	if (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1) return null;
	const decision = (body as Record<string, unknown>)["decision"];
	return decision === "approved" || decision === "denied" ? decision : null;
}

/** Return whether one path or header coordinate contains a non-empty identifier. */
function _isNonEmptyString(value: string): boolean
{
	return value.trim().length > 0;
}

/** Mint a one-use opaque resume marker without returning its secret material to the browser. */
function _resumeTokenHash(approvalRequestId: string): string
{
	return __DigestCanonicalJson({ approvalRequestId, nonce: randomUUID() });
}

/** Write one bounded JSON problem response. */
function _respond(response: Response, status: number, error: string): void
{
	response.status(status).json({ error });
}
