import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { type RuntimeWorkloadBinding } from "@opencrane/backend/agents/runtime/workloads/contract";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import { _ParseMcpExecutorControllerClaim, _ParseMcpExecutorControllerCleanupClaim, _ParseMcpExecutorControllerOutcome, _ParseMcpExecutorControllerReleaseClaim } from "./mcp-executor-controller.validator";
import type { McpExecutorCleanupCommand, McpExecutorControllerAuthority, McpExecutorControllerClaim, McpExecutorControllerCleanupClaim, McpExecutorControllerFetch, McpExecutorControllerHttpAuthorityOptions, McpExecutorControllerReleaseClaim, McpExecutorControllerTokenReader, McpExecutorPodRegistrationCommand, McpExecutorReleaseCommand } from "./mcp-executor-controller.types";

/** Largest server response this controller accepts. */
const _MAX_RESPONSE_BYTES = 32 * 1024;

/** Reads and parses a bounded JSON response. */
async function _Json(response: Response): Promise<unknown>
{
	if (response.body === null)
		throw new Error("OpenCrane MCP executor authority returned no response body");
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	while (true)
	{
		const result = await reader.read();
		if (result.done)
			break;
		length += result.value.byteLength;
		if (length > _MAX_RESPONSE_BYTES)
		{
			await reader.cancel();
			throw new Error("OpenCrane MCP executor response exceeded 32 KiB");
		}
		chunks.push(result.value);
	}
	try
	{
		return JSON.parse(Buffer.concat(chunks, length).toString("utf8"));
	}
	catch
	{
		throw new Error("OpenCrane MCP executor response was not valid JSON");
	}
}

/** Reads the token file Kubernetes rotates. */
function _TokenReader(path: string): McpExecutorControllerTokenReader
{
	return async function _ReadToken(): Promise<string>
	{
		const token = (await readFile(path, "utf8")).trim();
		if (token.length === 0)
			throw new Error("projected agent-controller token is empty");
		return token;
	};
}

/** Validates the internal HTTP origin. */
function _BaseUrl(value: string): URL
{
	const parsed = URL.parse(value);
	if (!parsed || parsed.protocol !== "http:" || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password)
		throw new Error("OPENCRANE_INTERNAL_URL must be one in-cluster HTTP origin");
	return parsed;
}

/** Creates request headers from the token read for this call. */
function _Headers(token: string): Headers { return new Headers({ authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" }); }

/** Creates the abort signal shared by process shutdown and one request deadline. */
function _Signal(signal: AbortSignal, timeout: number): AbortSignal { return AbortSignal.any([signal, AbortSignal.timeout(timeout)]); }

/** Checks an echoed outcome without trusting other response fields. */
async function _Outcome(response: Response, allowed: readonly string[]): Promise<string>
{
	return _ParseMcpExecutorControllerOutcome(await _Json(response), allowed);
}

/**
 * Creates the authenticated server adapter for MCP workload claims and fenced writes.
 *
 * The agent controller uses this adapter to receive server-selected MCP work and report Kubernetes
 * evidence. Every response is byte-bounded and checked against a strict schema before the adapter
 * returns it. A missing claim becomes `null`, while a conflict remains distinct from success.
 *
 * Called by: apps/agent-controller/src/index.ts.
 * @param options - In-cluster destination, rotating token reader, request deadline, and test seam.
 * @returns The controller authority backed by authenticated internal HTTP calls.
 * @throws Error When configuration, transport, response size, JSON, or response shape is invalid.
 */
export function __CreateHttpMcpExecutorControllerAuthority(options: McpExecutorControllerHttpAuthorityOptions): McpExecutorControllerAuthority
{
	const baseUrl = _BaseUrl(options.openCraneInternalUrl);
	if (!isAbsolute(options.tokenPath) || !Number.isSafeInteger(options.requestTimeoutMilliseconds) || options.requestTimeoutMilliseconds < 1_000 || options.requestTimeoutMilliseconds > 60_000)
		throw new Error("MCP executor authority requires an absolute token path and 1-60s timeout");
	const request: McpExecutorControllerFetch = options.fetch ?? fetch;
	const readToken = options.readToken ?? _TokenReader(options.tokenPath);
	async function _Request(path: string, method: "POST" | "PUT", body: unknown, signal: AbortSignal): Promise<Response>
	{
		return ___DoWithTrace("agent_controller.mcp_executor.http", { method }, async function _Send(): Promise<Response>
		{
			return request(new URL(path, baseUrl), { method, headers: _Headers(await readToken()), body: JSON.stringify(body), signal: _Signal(signal, options.requestTimeoutMilliseconds) });
		});
	}
	return {
		async __Claim(signal: AbortSignal): Promise<McpExecutorControllerClaim | null>
		{
			return ___DoWithTrace("agent_controller.mcp_executor.claim", {}, async function _ClaimWork(): Promise<McpExecutorControllerClaim | null>
			{
				const response = await _Request("/api/internal/agent-controller/mcp-executor:claim", "POST", {}, signal);
				if (response.status === 204)
					return null;
				if (response.status !== 200)
					throw new Error(`OpenCrane MCP executor claim failed with HTTP ${response.status}`);
				return _ParseMcpExecutorControllerClaim(await _Json(response));
			});
		},
		async __CommitAssignment(binding: RuntimeWorkloadBinding, signal: AbortSignal): Promise<"assigned" | "idempotent" | "conflict">
		{
			const response = await _Request(`/api/internal/agent-controller/mcp-executor/${encodeURIComponent(binding.claimId)}/assignment`, "PUT", binding, signal);
			if (response.status === 409)
				return "conflict";
			if (response.status !== 200)
				throw new Error(`OpenCrane MCP executor assignment failed with HTTP ${response.status}`);
			return await _Outcome(response, ["assigned", "idempotent"]) as "assigned" | "idempotent";
		},
		async __ClaimRelease(signal: AbortSignal): Promise<McpExecutorControllerReleaseClaim | null>
		{
			const response = await _Request("/api/internal/agent-controller/mcp-executor:release-claim", "POST", {}, signal);
			if (response.status === 204)
				return null;
			if (response.status !== 200)
				throw new Error(`OpenCrane MCP executor release claim failed with HTTP ${response.status}`);
			return _ParseMcpExecutorControllerReleaseClaim(await _Json(response));
		},
		async __CommitRelease(claimId: string, command: McpExecutorReleaseCommand, signal: AbortSignal): Promise<"released" | "idempotent" | "conflict">
		{
			const response = await _Request(`/api/internal/agent-controller/mcp-executor/${encodeURIComponent(claimId)}/release`, "PUT", command, signal);
			if (response.status === 409)
				return "conflict";
			if (response.status !== 200)
				throw new Error(`OpenCrane MCP executor release failed with HTTP ${response.status}`);
			return await _Outcome(response, ["released", "idempotent"]) as "released" | "idempotent";
		},
		async __ClaimCleanup(signal: AbortSignal): Promise<McpExecutorControllerCleanupClaim | null>
		{
			const response = await _Request("/api/internal/agent-controller/mcp-executor:cleanup-claim", "POST", {}, signal);
			if (response.status === 204)
				return null;
			if (response.status !== 200)
				throw new Error(`OpenCrane MCP executor cleanup claim failed with HTTP ${response.status}`);
			return _ParseMcpExecutorControllerCleanupClaim(await _Json(response));
		},
		async __CommitCleanup(claimId: string, command: McpExecutorCleanupCommand, signal: AbortSignal): Promise<"cleaned" | "idempotent" | "conflict">
		{
			const response = await _Request(`/api/internal/agent-controller/mcp-executor/${encodeURIComponent(claimId)}/cleanup`, "PUT", command, signal);
			if (response.status === 409)
				return "conflict";
			if (response.status !== 200)
				throw new Error(`OpenCrane MCP executor cleanup failed with HTTP ${response.status}`);
			return await _Outcome(response, ["cleaned", "idempotent"]) as "cleaned" | "idempotent";
		},
		async __RegisterFirstPod(claimId: string, command: McpExecutorPodRegistrationCommand, signal: AbortSignal): Promise<"registered" | "idempotent" | "conflict">
		{
			const response = await _Request(`/api/internal/agent-controller/mcp-executor/${encodeURIComponent(claimId)}/pod-registration`, "PUT", command, signal);
			if (response.status === 409)
				return "conflict";
			if (response.status !== 200)
				throw new Error(`OpenCrane MCP executor Pod registration failed with HTTP ${response.status}`);
			return await _Outcome(response, ["registered", "idempotent"]) as "registered" | "idempotent";
		},
	};
}
