import { Router, type Request, type Response } from "express";

// Side-effect import: loads the verified browser-session `authUser` augmentation.
import "@opencrane/backend/server/infra/auth";
import type { Logger } from "@opencrane/backend/observability";

import type { ChannelResolutionAction, ChannelTargetResolutionDependencies, ResolveChannelTargetCommand } from "./channel-target-resolution.types.js";
import { __ResolveChannelTarget } from "./channel-target-resolution.js";

/** Public identity assertions that an internal workload must never submit on behalf of a browser. */
const _FORBIDDEN_IDENTITY_HEADERS = ["x-opencrane-subject", "x-forwarded-user", "x-auth-request-user", "x-remote-user"];

/** Builds the workload-authenticated internal channel target resolver router. */
export function __CreateChannelTargetsRouter(dependencies: ChannelTargetResolutionDependencies, log: Logger): Router
{
	const router = Router();
	router.post("/", async function _resolve(request: Request, response: Response)
	{
		// 1. Reject identity assertions and require the standard header to contain only workload auth.
		if (_FORBIDDEN_IDENTITY_HEADERS.some(header => request.header(header) !== undefined))
		{
			_respondProblem(response, 400, "forged_identity");
			return;
		}
		const workloadToken = _bearerValue(request.header("authorization"));
		const command = workloadToken === null ? null : _parseCommand(request, workloadToken);
		if (command === null)
		{
			_respondInvalidCommand(response, workloadToken);
			return;
		}

		// 2. Delegate every identity, membership, authorization, and route decision to the domain use case.
		try
		{
			const result = await __ResolveChannelTarget(dependencies, command);
			if (result.outcome !== "authorized")
			{
				_respondProblem(response, _denialStatus(result.reason), result.reason);
				return;
			}

			// 3. Return only the exact route and opaque short-lived context required by channel-proxy.
			response.status(200).json(result.target);
		}
		catch (error)
		{
			log.error({ err: error, action: command.action, conversationId: command.conversationId }, "channel target authority failed");
			_respondProblem(response, 503, "authority_unavailable");
		}
	});
	return router;
}

/** Maps absent workload authentication separately from a malformed authenticated command. */
function _respondInvalidCommand(response: Response, workloadToken: string | null): void
{
	if (workloadToken === null) _respondProblem(response, 401, "workload_auth_required");
	else _respondProblem(response, 400, "invalid_request");
}

/** Maps channel-target denial classes without nested conditional expressions. */
function _denialStatus(reason: string): number
{
	if (reason === "route_denied") return 503;
	if (reason === "workload_denied" || reason === "identity_denied") return 401;
	return 403;
}

/** Parses the internal request without accepting self-asserted subject or silo fields. */
function _parseCommand(request: Request, workloadToken: string): ResolveChannelTargetCommand | null
{
	if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) return null;
	const body = request.body as Record<string, unknown>;
	if (!_isAction(body["action"]) || typeof body["trustedHost"] !== "string" || typeof body["conversationId"] !== "string" || body["requestIdempotencyKey"] !== undefined || (body["cursor"] !== undefined && typeof body["cursor"] !== "string")) return null;
	const subjectId = request.session?.authUser?.sub?.trim();
	if (!subjectId) return null;
	return { workloadToken, delegatedIdentity: { subjectId, source: "cookie", trustworthySubject: true }, trustedHost: body["trustedHost"], action: body["action"], conversationId: body["conversationId"], cursor: body["cursor"] as string | undefined };
}

/** Returns a bearer value only for one unambiguous standard Authorization header. */
function _bearerValue(value: string | undefined): string | null
{
	if (!value) return null;
	const match = /^Bearer ([^\s,]+)$/u.exec(value);
	return match?.[1] ?? null;
}

/** Narrows an untrusted value to the public channel action vocabulary. */
function _isAction(value: unknown): value is ChannelResolutionAction
{
	return value === "events.read";
}

/** Writes a non-sensitive internal problem response. */
function _respondProblem(response: Response, status: number, code: string): void
{
	response.status(status).json({ error: code });
}
