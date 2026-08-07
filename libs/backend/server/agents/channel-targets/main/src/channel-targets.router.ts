import { Router, type Request, type Response } from "express";

import type { ChannelResolutionAction, ChannelTargetResolutionDependencies, ResolveChannelTargetCommand } from "./channel-target-resolution.types.js";
import { __ResolveChannelTarget } from "./channel-target-resolution.js";

/** Public identity assertions that an internal workload must never submit on behalf of a browser. */
const _FORBIDDEN_IDENTITY_HEADERS = ["x-opencrane-subject", "x-forwarded-user", "x-auth-request-user", "x-remote-user"];

/** Builds the workload-authenticated internal channel target resolver router. */
export function __CreateChannelTargetsRouter(dependencies: ChannelTargetResolutionDependencies): Router
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
			_respondProblem(response, workloadToken === null ? 401 : 400, workloadToken === null ? "workload_auth_required" : "invalid_request");
			return;
		}

		// 2. Delegate every identity, membership, authorization, and route decision to the domain use case.
		try
		{
			const result = await __ResolveChannelTarget(dependencies, command);
			if (result.outcome !== "authorized")
			{
				const unavailable = result.reason === "run_unavailable" || result.reason === "route_denied";
				const unauthenticated = result.reason === "workload_denied" || result.reason === "identity_denied";
				_respondProblem(response, unavailable ? 503 : unauthenticated ? 401 : 403, result.reason);
				return;
			}

			// 3. Return only the exact route and opaque short-lived context required by channel-proxy.
			response.status(200).json(result.target);
		}
		catch
		{
			_respondProblem(response, 503, "authority_unavailable");
		}
	});
	return router;
}

/** Parses the internal request without accepting self-asserted subject or silo fields. */
function _parseCommand(request: Request, workloadToken: string): ResolveChannelTargetCommand | null
{
	if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) return null;
	const body = request.body as Record<string, unknown>;
	if (!_isAction(body["action"]) || typeof body["trustedHost"] !== "string" || typeof body["threadId"] !== "string" || (body["requestIdempotencyKey"] !== undefined && typeof body["requestIdempotencyKey"] !== "string") || (body["cursor"] !== undefined && typeof body["cursor"] !== "string")) return null;
	const delegatedAuthorization = request.header("x-opencrane-session-authorization");
	return { workloadToken, cookie: request.header("cookie"), delegatedAuthorization, trustedHost: body["trustedHost"], action: body["action"], threadId: body["threadId"], requestIdempotencyKey: body["requestIdempotencyKey"] as string | undefined, cursor: body["cursor"] as string | undefined };
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
	return value === "command.forward" || value === "events.read";
}

/** Writes a non-sensitive internal problem response. */
function _respondProblem(response: Response, status: number, code: string): void
{
	response.status(status).json({ error: code });
}
