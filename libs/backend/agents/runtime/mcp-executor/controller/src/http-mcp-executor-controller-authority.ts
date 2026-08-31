import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { RuntimeWorkloadClaimClasses, type RuntimeWorkloadBinding } from "@opencrane/backend/agents/runtime/workloads/contract";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import type { McpExecutorControllerAuthority, McpExecutorControllerClaim, McpExecutorControllerFetch, McpExecutorControllerHttpAuthorityOptions, McpExecutorControllerReleaseClaim, McpExecutorControllerTokenReader, McpExecutorPodRegistrationCommand, McpExecutorReleaseCommand } from "./mcp-executor-controller.types";

/** Largest server response this controller accepts. */
const _MAX_RESPONSE_BYTES = 32 * 1024;

/** Accepts one database coordinate without control characters. */
function _IsCoordinate(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value); }

/** Accepts a UTC instant with millisecond precision. */
function _IsInstant(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)); }

/** Accepts an immutable OCI registry reference. */
function _IsRegistryReference(value: unknown): value is string { return typeof value === "string" && /^[a-z0-9][a-z0-9._:-]*(?:\/[a-z0-9][a-z0-9._/-]*)+@sha256:[a-f0-9]{64}$/.test(value); }

/** Parses an untrusted claim response into the MCP controller contract. */
function _Claim(value: unknown): McpExecutorControllerClaim
{
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("OpenCrane MCP executor claim was invalid");
	const record = value as Record<string, unknown>;
	const claim = record["claim"];
	if (Object.keys(record).length !== 2 || typeof claim !== "object" || claim === null || Array.isArray(claim))
		throw new Error("OpenCrane MCP executor claim was invalid");
	const candidate = claim as Record<string, unknown>;
	const keys = ["claimId", "siloId", "workloadClass", "profileName", "idempotencyKey", "claimedAt", "deliveryCount", "expiresAt", "executionReference"];
	if (Object.keys(candidate).length !== keys.length || !keys.every(function _HasKey(key): boolean { return Object.hasOwn(candidate, key); }) || ![candidate["claimId"], candidate["siloId"], candidate["profileName"], candidate["idempotencyKey"], candidate["executionReference"]].every(_IsCoordinate) || candidate["workloadClass"] !== RuntimeWorkloadClaimClasses.McpExecutor || !_IsInstant(candidate["claimedAt"]) || !_IsInstant(candidate["expiresAt"]) || !Number.isSafeInteger(candidate["deliveryCount"]) || Number(candidate["deliveryCount"]) < 1 || !_IsRegistryReference(record["registryReference"]))
		throw new Error("OpenCrane MCP executor claim was invalid");
	return { claim: candidate as unknown as McpExecutorControllerClaim["claim"], registryReference: record["registryReference"] };
}

/** Parses a release claim and keeps its assignment and release fences. */
function _ReleaseClaim(value: unknown): McpExecutorControllerReleaseClaim
{
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("OpenCrane MCP executor release claim was invalid");
	const record = value as Record<string, unknown>;
	const base = _Claim({ claim: record["claim"], registryReference: record["registryReference"] });
	if (Object.keys(record).length !== 6 || !_IsCoordinate(record["workloadUid"]) || !_IsInstant(record["releaseClaimedAt"]) || !Number.isSafeInteger(record["releaseDeliveryCount"]) || Number(record["releaseDeliveryCount"]) < 1 || !_IsInstant(record["releaseExpiresAt"]))
		throw new Error("OpenCrane MCP executor release claim was invalid");
	return { ...base, workloadUid: record["workloadUid"], releaseClaimedAt: record["releaseClaimedAt"], releaseDeliveryCount: record["releaseDeliveryCount"] as number, releaseExpiresAt: record["releaseExpiresAt"] };
}

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
	const value = await _Json(response);
	if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length !== 1 || !allowed.includes(String((value as Record<string, unknown>)["outcome"])))
		throw new Error("OpenCrane MCP executor outcome was invalid");
	return String((value as Record<string, unknown>)["outcome"]);
}

/** Creates the authenticated server adapter for MCP workload claims and binding writes. */
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
				return _Claim(await _Json(response));
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
			return _ReleaseClaim(await _Json(response));
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
