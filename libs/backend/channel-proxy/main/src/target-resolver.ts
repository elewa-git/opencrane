import { readFile } from "node:fs/promises";

import { ___ParseAndValidateJson } from "@opencrane/util";

import type { AuthorizedChannelTarget, ChannelTargetResolver, OpenCraneResolverOptions, TargetResolutionRequest } from "./channel-proxy.types";

/** Default path of the audience-bound channel-proxy workload token. */
export const __CHANNEL_PROXY_TOKEN_PATH = "/var/run/opencrane/tokens/opencrane.token";

/**
 * Client that asks OpenCrane to authorize one event-stream request and return where to read it.
 *
 * Authenticates as this workload with its projected ServiceAccount token, re-read from disk on
 * every call so kubelet rotation needs no restart. It forwards the browser's own authorization
 * value in a separate private header, so OpenCrane can authorize the user while still knowing
 * which workload is asking.
 *
 * Called by: `apps/channel-proxy/src/server.ts`.
 * @implements ChannelTargetResolver
 */
export class __OpenCraneTargetResolver implements ChannelTargetResolver
{
	/** Validated client options. */
	private readonly options: OpenCraneResolverOptions;

	/**
	 * Construct a resolver.
	 * @param options - Requires `baseUrl`; `workloadTokenPath`, `timeoutMs`, `readFile`, and `fetch` all fall back to defaults suitable for production.
	 */
	constructor(options: Partial<OpenCraneResolverOptions> & Pick<OpenCraneResolverOptions, "baseUrl">)
	{
		this.options = {
			baseUrl: options.baseUrl,
			workloadTokenPath: options.workloadTokenPath ?? __CHANNEL_PROXY_TOKEN_PATH,
			timeoutMs: options.timeoutMs ?? 3_000,
			readFile: options.readFile ?? readFile,
			fetch: options.fetch ?? fetch,
		};
	}

	/**
	 * Ask OpenCrane to authorize one event-stream read and return where to read it.
	 *
	 * Re-reads the workload token on every call, then applies its own timeout independently of the
	 * browser connection so a slow authority cannot pin the request open. Any non-200, any response
	 * that is not the exact expected shape, and any oversized body all throw rather than returning a
	 * partial target.
	 * @param request - The session, action, conversation, and optional cursor to authorize.
	 * @param signal - Caller cancellation; combined with this client's own timeout.
	 * @returns The authorized internal endpoint plus a short-lived invocation context and its expiry.
	 * @throws Error when the token cannot be read, the call fails or times out, or the response is not the expected shape.
	 */
	async resolve(request: TargetResolutionRequest, signal: AbortSignal): Promise<AuthorizedChannelTarget>
	{
		// 1. Read the rotating projected token for every call so kubelet rotation needs no restart.
		const workloadToken = (await this.options.readFile(this.options.workloadTokenPath, "utf8")).trim();
		if (!workloadToken)
		{
			throw new Error("channel resolver workload token is empty");
		}

		// 2. Bound the authority call independently of the public connection lifetime.
		const timeout = new AbortController();
		const timeoutHandle = setTimeout(function _abortResolver() { timeout.abort(new DOMException("channel resolver timeout", "TimeoutError")); }, this.options.timeoutMs);
		const combined = AbortSignal.any([signal, timeout.signal]);
		const headers = new Headers({ "content-type": "application/json", authorization: `Bearer ${workloadToken}` });
		if (request.session.cookie)
		{
			headers.set("cookie", request.session.cookie);
		}
		if (request.session.authorization)
		{
			// X-OpenCrane-Session-Authorization carries the user's original authorization value while
			// the standard Authorization header authenticates this workload to OpenCrane. It follows
			// the private X- header convention retained for internal protocols.
			// @see https://www.rfc-editor.org/rfc/rfc6648
			headers.set("x-opencrane-session-authorization", request.session.authorization);
		}

		// 3. Ask the sole product authority for one exact route and short-lived invocation context.
		try
		{
			const response = await this.options.fetch(new URL("/api/internal/channel-targets:resolve", this.options.baseUrl), {
				method: "POST",
				headers,
				body: JSON.stringify({ action: request.action, trustedHost: request.session.trustedHost, conversationId: request.conversationId, cursor: request.cursor }),
				signal: combined,
			});
			if (!response.ok)
			{
				throw new Error(`channel target resolution denied with status ${response.status}`);
			}

			return ___ParseAndValidateJson(await response.text(), "channel target response", _ParseTarget);
		}
		finally
		{
			clearTimeout(timeoutHandle);
		}
	}
}

/** Validate OpenCrane's response field by field, so a wrong-shaped body throws instead of being cast into the expected type. */
function _ParseTarget(value: unknown): AuthorizedChannelTarget
{
	if (!value || typeof value !== "object" || Array.isArray(value))
	{
		throw new Error("channel target response is not an object");
	}
	const record = value as Record<string, unknown>;
	if (typeof record.subjectId !== "string" || !record.subjectId || typeof record.endpoint !== "string" || typeof record.invocationContext !== "string" || !record.invocationContext || typeof record.expiresAt !== "string")
	{
		throw new Error("channel target response is incomplete");
	}
	const expiry = Date.parse(record.expiresAt);
	if (!Number.isFinite(expiry) || expiry <= Date.now())
	{
		throw new Error("channel target response is expired");
	}
	return { subjectId: record.subjectId, endpoint: record.endpoint, invocationContext: record.invocationContext, expiresAt: record.expiresAt };
}
