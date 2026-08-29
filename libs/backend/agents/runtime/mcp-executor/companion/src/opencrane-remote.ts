import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { ___DoWithTrace, ___DoWithoutTrace } from "@opencrane/backend/observability";

import { _BoundedJsonBody, _FetchJson, _ReadBoundedJson } from "./bounded-json";
import { __ParseMcpCompanionClaimResponse } from "./mcp-companion-wire";
import { McpCompanionCommandKinds, McpCompanionRemoteClaimOutcomes, type McpCompanionCommand, type McpCompanionCommandLease, type McpCompanionCompletion, type McpCompanionFailureCodes, type McpCompanionIdentity, type McpCompanionRemote, type McpCompanionRemoteOptions } from "./mcp-companion.types";

/**
 * Creates the authenticated companion-to-OpenCrane command adapter for one executor Pod.
 *
 * The adapter is not the Pod-local connection to the uploaded MCP server. It calls only the fixed
 * in-cluster OpenCrane executor route, rereads the rotating projected token for every request, and
 * carries a server-issued `executionId` plus `claimFence` on each terminal report. The uploaded
 * server never receives the token or the opaque execution reference.
 *
 * Called by: apps/mcp-executor/src/index.ts.
 * @param options - Fixed destination, token reader, request deadline, and byte ceilings for one Pod.
 * @returns The remote used to claim one server-selected command and report its fenced outcome.
 */
export function __CreateMcpCompanionRemote(options: McpCompanionRemoteOptions): McpCompanionRemote
{
	// 1. Refuse a substituted destination or unbounded transport before the Pod can make its first call.
	_AssertOptions(options);

	// 2. Keep the token reader injectable for tests, but use the projected file at every production request.
	const fetcher = options.fetch ?? fetch;
	const readToken = options.readToken ?? async function _ReadProjectedToken(): Promise<string> { return readFile(options.tokenPath, "utf8"); };

	// 3. Expose only server-selected claim and fence-bound terminal operations to the companion loop.
	return {
		claim(identity, signal) { return _Claim(options, fetcher, readToken, identity, signal); },
		complete(identity, lease, completion, signal) { return _Report(options, fetcher, readToken, identity, lease, { completion }, "completion", signal); },
		fail(identity, lease, failureCode, signal) { return _Report(options, fetcher, readToken, identity, lease, { failureCode }, "failure", signal); },
	};
}

/** Reject any destination, mounted path, deadline, or byte ceiling outside the companion contract. */
function _AssertOptions(options: McpCompanionRemoteOptions): void
{
	const url = new URL(options.openCraneExecutorUrl);
	const port = Number(url.port);
	if (url.protocol !== "http:" || url.username || url.password || !url.hostname.endsWith(".svc.cluster.local") || !Number.isSafeInteger(port) || port < 1 || port > 65_535 || url.pathname !== "/api/internal/mcp-executor" || url.search || url.hash || !isAbsolute(options.tokenPath) || !Number.isSafeInteger(options.requestTimeoutMilliseconds) || options.requestTimeoutMilliseconds < 1 || options.requestTimeoutMilliseconds > 60_000 || !Number.isSafeInteger(options.maximumResponseBytes) || options.maximumResponseBytes < 1 || options.maximumResponseBytes > 1_048_576 || !Number.isSafeInteger(options.maximumRequestBytes) || options.maximumRequestBytes < 1 || options.maximumRequestBytes > 4_456_448)
		throw new Error("MCP companion OpenCrane adapter requires the fixed endpoint, an absolute token path, and bounded transport limits");
}

/** Claim at most one server-selected command for the exact projected workload identity. */
async function _Claim(options: McpCompanionRemoteOptions, fetcher: NonNullable<McpCompanionRemoteOptions["fetch"]>, readToken: NonNullable<McpCompanionRemoteOptions["readToken"]>, identity: McpCompanionIdentity, signal: AbortSignal): Promise<McpCompanionCommand | McpCompanionRemoteClaimOutcomes.Terminal | null>
{
	return ___DoWithTrace("mcp_companion.command.claim", {}, async function _ClaimCommand(): Promise<McpCompanionCommand | McpCompanionRemoteClaimOutcomes.Terminal | null>
	{
		// 1. Send only the Pod identity to OpenCrane, which chooses any discovery or invocation command.
		const body = _BoundedJsonBody(identity, options.maximumRequestBytes);
		const headers = await _Headers(readToken, body);
		const response = await ___DoWithoutTrace(function _SendClaim() { return _FetchJson(fetcher, `${options.openCraneExecutorUrl}/claim`, { method: "POST", headers, body, redirect: "error" }, options.requestTimeoutMilliseconds, signal); });
		if (response.status === 204)
			return null;
		if (response.status === 410)
			return McpCompanionRemoteClaimOutcomes.Terminal;
		if (!response.ok)
			throw new Error(`MCP companion claim failed with HTTP ${response.status}`);
		const value = await _ReadBoundedJson(response, options.maximumResponseBytes);
		const claim = __ParseMcpCompanionClaimResponse(value);
		// 2. Preserve the server-issued lease so a terminal write cannot be replayed for another claim.
		const lease = { executionId: claim.executionId, claimFence: claim.claimFence, expiresAt: claim.expiresAt };
		return claim.kind === McpCompanionCommandKinds.Discovery ? { kind: claim.kind, lease } : { kind: claim.kind, lease, invocationId: claim.invocationId, toolName: claim.toolName, arguments: claim.arguments };
	});
}

/** Submit one completion or stable failure through the current server-issued fence. */
async function _Report(options: McpCompanionRemoteOptions, fetcher: NonNullable<McpCompanionRemoteOptions["fetch"]>, readToken: NonNullable<McpCompanionRemoteOptions["readToken"]>, identity: McpCompanionIdentity, lease: McpCompanionCommandLease, outcome: { readonly completion: McpCompanionCompletion } | { readonly failureCode: McpCompanionFailureCodes }, suffix: "completion" | "failure", signal: AbortSignal): Promise<void>
{
	const fields = { outcome: suffix };
	return ___DoWithTrace(`mcp_companion.command.${suffix}`, fields, async function _ReportOutcome(): Promise<void>
	{
		// 1. Bind the result to the current execution and fence instead of trusting a companion-selected target.
		const body = _BoundedJsonBody({ ...identity, executionId: lease.executionId, claimFence: lease.claimFence, ...outcome }, options.maximumRequestBytes);
		const headers = await _Headers(readToken, body);

		// 2. Use the fixed terminal route and reject every non-empty-success result without a retry loop.
		const path = `${options.openCraneExecutorUrl}/${suffix === "completion" ? "complete" : "fail"}`;
		const response = await ___DoWithoutTrace(function _SendOutcome() { return _FetchJson(fetcher, path, { method: "POST", headers, body, redirect: "error" }, options.requestTimeoutMilliseconds, signal); });
		if (response.status !== 204)
			throw new Error(`MCP companion ${suffix} failed with HTTP ${response.status}`);
	});
}

/** Read the projected token for every request and build exact JSON headers. */
async function _Headers(readToken: NonNullable<McpCompanionRemoteOptions["readToken"]>, body: string): Promise<Record<string, string>>
{
	const token = (await readToken()).trim();
	if (!token)
		throw new Error("MCP companion projected token is empty");
	return { authorization: `Bearer ${token}`, "content-type": "application/json", "content-length": String(Buffer.byteLength(body, "utf8")) };
}
