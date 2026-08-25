import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { ___IsAgentControllerIdentifier, ___ParseAgentControllerMcpbValidationAssignmentResult, ___ParseAgentControllerMcpbValidationClaim } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ___ParseAndValidateJson } from "@opencrane/util";

import type { McpbValidationControllerAuthority, McpbValidationControllerFetch, McpbValidationControllerHttpAuthorityOptions, McpbValidationControllerTokenReader } from "./mcpb-validation-controller.types";

/** Bound one controller response before parsing it. */
const _MAX_RESPONSE_BYTES = 16 * 1024;

/** Read a small JSON response before its contract parser sees it. */
async function _ReadJson(response: Response): Promise<unknown>
{
	const contentLength = response.headers.get("content-length");
	if (contentLength !== null && (!Number.isSafeInteger(Number(contentLength)) || Number(contentLength) < 0 || Number(contentLength) > _MAX_RESPONSE_BYTES))
	{
		await response.body?.cancel();
		throw new Error("OpenCrane MCP bundle validation response exceeded the 16 KiB boundary");
	}
	if (response.body === null)
	{
		throw new Error("OpenCrane MCP bundle validation authority returned no response body");
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	while (true)
	{
		const next = await reader.read();
		if (next.done)
		{
			return ___ParseAndValidateJson(Buffer.concat(chunks, length).toString("utf8"), "OpenCrane MCP bundle validation response", function _Identity(value: unknown): unknown { return value; });
		}
		length += next.value.byteLength;
		if (length > _MAX_RESPONSE_BYTES)
		{
			await reader.cancel();
			throw new Error("OpenCrane MCP bundle validation response exceeded the 16 KiB boundary");
		}
		chunks.push(next.value);
	}
}

/** Read the current Kubernetes-projected controller token. */
function _TokenReader(path: string): McpbValidationControllerTokenReader
{
	return async function _ReadToken(): Promise<string>
	{
		const token = (await readFile(path, "utf8")).trim();
		if (token.length === 0)
		{
			throw new Error("projected agent-controller token is empty");
		}
		return token;
	};
}

/** Read the fixed internal base URL without accepting paths or credentials. */
function _BaseUrl(value: string): URL
{
	const parsed = URL.parse(value);
	if (!parsed || parsed.protocol !== "http:" || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "" || parsed.username !== "" || parsed.password !== "")
	{
		throw new Error("OPENCRANE_INTERNAL_URL must be one in-cluster HTTP origin with no path or credentials");
	}
	return parsed;
}

/** Build headers for an internal controller request without writing its bearer token to logs. */
function _Headers(token: string): Headers
{
	return new Headers({ authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" });
}

/** Create the internal-server adapter used by the MCP bundle validation controller. */
export function __CreateHttpMcpbValidationControllerAuthority(options: McpbValidationControllerHttpAuthorityOptions): McpbValidationControllerAuthority
{
	const baseUrl = _BaseUrl(options.openCraneInternalUrl);
	if (!isAbsolute(options.tokenPath) || !Number.isSafeInteger(options.requestTimeoutMilliseconds) || options.requestTimeoutMilliseconds < 1_000 || options.requestTimeoutMilliseconds > 60_000)
	{
		throw new Error("MCP bundle validation HTTP authority requires an absolute token path and 1-60s timeout");
	}
	const fetchRequest = options.fetch ?? fetch;
	const readToken = options.readToken ?? _TokenReader(options.tokenPath);
	return {
		async __Claim(signal: AbortSignal)
		{
			return ___DoWithTrace("agent_controller.mcpb_validation.claim", {}, async function _Claim()
			{
				const response = await fetchRequest(new URL("/api/internal/agent-controller/mcpb-validations:claim", baseUrl), { method: "POST", headers: _Headers(await readToken()), body: "{}", signal: AbortSignal.any([signal, AbortSignal.timeout(options.requestTimeoutMilliseconds)]) });
				if (response.status === 204)
				{
					return null;
				}
				if (response.status !== 200)
				{
					throw new Error(`OpenCrane MCP bundle validation claim failed with HTTP ${response.status}`);
				}
				return ___ParseAgentControllerMcpbValidationClaim(await _ReadJson(response));
			});
		},
		async __CommitAssignment(workloadId, command, signal)
		{
			return ___DoWithTrace("agent_controller.mcpb_validation.assignment", { workloadId, workloadUid: command.workloadUid }, async function _CommitAssignment()
			{
				if (!___IsAgentControllerIdentifier(workloadId))
				{
					throw new Error("MCP bundle validation assignment requires one valid workload id");
				}
				const response = await fetchRequest(new URL(`/api/internal/agent-controller/mcpb-validations/${encodeURIComponent(workloadId)}/assignment`, baseUrl), { method: "PUT", headers: _Headers(await readToken()), body: JSON.stringify(command), signal: AbortSignal.any([signal, AbortSignal.timeout(options.requestTimeoutMilliseconds)]) });
				if (response.status === 409)
				{
					return "conflict";
				}
				if (response.status !== 200)
				{
					throw new Error(`OpenCrane MCP bundle validation assignment failed with HTTP ${response.status}`);
				}
				return ___ParseAgentControllerMcpbValidationAssignmentResult(await _ReadJson(response), workloadId, command).outcome;
			});
		},
	};
}
