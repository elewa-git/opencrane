import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { __ParseAgentRunWorkflowBindingOutcome, __ParseAgentRunWorkflowControllerRecord, __ParseAgentRunWorkflowObservation, type AgentRunTaskInput, type AgentRunWarmRuntimeActivationCommand, type AgentRunWarmRuntimeControllerAuthority, type AgentRunWarmRuntimeDeletionCommand, type AgentRunWarmRuntimeReadinessCommand, type AgentRunWarmRuntimeReservationCommand, type AgentRunWorkflowControllerRecord, type AgentRunWorkflowObservation } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import { ___ParseAndValidateJson } from "@opencrane/util";

import type { AgentRunWorkflowControllerHttpAuthorityOptions, AgentRunWorkflowControllerTokenReader } from "./agent-run-workflow-http-authority.types";

/** Limits an internal controller response before it reaches a task handler. */
const _MAX_RESPONSE_BYTES = 16 * 1024;

/** Reads the rotating projected controller token without retaining it in memory. */
function _CreateTokenReader(path: string): AgentRunWorkflowControllerTokenReader
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

/** Requires one Kubernetes DNS label before it becomes part of a trusted Service hostname. */
function _KubernetesName(value: string, name: string): string
{
	if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/u.test(value) || value.length > 63)
	{
		throw new Error(`${name} must be one Kubernetes DNS label`);
	}
	return value;
}

/** Requires the configured in-cluster OpenCrane Service before any projected token is read. */
function _BaseUrl(value: string, serverServiceName: string, serverNamespace: string): URL
{
	const parsed = URL.parse(value);
	const hostname = `${_KubernetesName(serverServiceName, "serverServiceName")}.${_KubernetesName(serverNamespace, "serverNamespace")}.svc.cluster.local`;
	if (!parsed || parsed.protocol !== "http:" || parsed.hostname !== hostname || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "" || parsed.username !== "" || parsed.password !== "")
	{
		throw new Error("OPENCRANE_INTERNAL_URL must be one same-silo in-cluster HTTP origin with no path or credentials");
	}
	return parsed;
}

/** Builds JSON headers for one controller-token-authenticated request. */
function _Headers(token: string): Headers
{
	return new Headers({ authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" });
}

/** Combines controller shutdown with the fixed per-request timeout. */
function _RequestSignal(shutdownSignal: AbortSignal | undefined, timeoutMilliseconds: number): AbortSignal
{
	if (shutdownSignal === undefined)
	{
		return AbortSignal.timeout(timeoutMilliseconds);
	}
	return AbortSignal.any([shutdownSignal, AbortSignal.timeout(timeoutMilliseconds)]);
}

/** Reads and bounds a server response before strict JSON validation. */
async function _ReadBoundedText(response: Response): Promise<string>
{
	const length = response.headers.get("content-length");
	if (length !== null)
	{
		const declared = Number(length);
		if (!Number.isSafeInteger(declared) || declared < 0 || declared > _MAX_RESPONSE_BYTES)
		{
			await response.body?.cancel();
			throw new Error("OpenCrane AgentRun workflow response exceeded the 16 KiB boundary");
		}
	}
	if (response.body === null)
	{
		throw new Error("OpenCrane AgentRun workflow authority returned no response body");
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	while (true)
	{
		const result = await reader.read();
		if (result.done)
		{
			return Buffer.concat(chunks, byteLength).toString("utf8");
		}
		byteLength += result.value.byteLength;
		if (byteLength > _MAX_RESPONSE_BYTES)
		{
			await reader.cancel();
			throw new Error("OpenCrane AgentRun workflow response exceeded the 16 KiB boundary");
		}
		chunks.push(result.value);
	}
}

/** Parses one bounded response with the contract validator the controller shares with the server. */
async function _ReadJson<T>(response: Response, parser: (value: unknown) => T | null): Promise<T>
{
	const parsed = ___ParseAndValidateJson(await _ReadBoundedText(response), "OpenCrane AgentRun workflow response", parser);
	if (parsed === null)
	{
		throw new Error("OpenCrane AgentRun workflow response did not match its contract");
	}
	return parsed;
}

/** Creates the controller HTTP adapter for the one-shot warm AgentRun lifecycle. */
export function __CreateHttpWarmAgentRunWorkflowControllerAuthority(options: AgentRunWorkflowControllerHttpAuthorityOptions): AgentRunWarmRuntimeControllerAuthority
{
	const baseUrl = _BaseUrl(options.openCraneInternalUrl, options.serverServiceName, options.serverNamespace);
	if (!isAbsolute(options.tokenPath) || !Number.isSafeInteger(options.requestTimeoutMilliseconds) || options.requestTimeoutMilliseconds < 1_000 || options.requestTimeoutMilliseconds > 60_000)
	{
		throw new Error("warm AgentRun HTTP authority requires an absolute token path and 1-60s timeout");
	}
	const fetchRequest = options.fetch ?? fetch;
	const readToken = options.readToken ?? _CreateTokenReader(options.tokenPath);
	async function _Request(path: string, body: unknown): Promise<Response>
	{
		return await fetchRequest(new URL(path, baseUrl), { method: "POST", headers: _Headers(await readToken()), body: JSON.stringify(body), signal: _RequestSignal(options.shutdownSignal, options.requestTimeoutMilliseconds) });
	}
	async function _Binding(path: string, input: AgentRunTaskInput, task: IWorkflowTaskReceipt, command: AgentRunWarmRuntimeReservationCommand | AgentRunWarmRuntimeActivationCommand | AgentRunWarmRuntimeReadinessCommand | AgentRunWarmRuntimeDeletionCommand): Promise<"bound" | "idempotent" | "conflict">
	{
		const response = await _Request(path, { input, task, command });
		if (response.status === 409)
		{
			return "conflict";
		}
		if (response.status !== 200)
		{
			throw new Error(`warm AgentRun binding failed with HTTP ${response.status}`);
		}
		return await _ReadJson(response, __ParseAgentRunWorkflowBindingOutcome);
	}
	return {
		async loadForTask(input, task): Promise<AgentRunWorkflowControllerRecord | null>
		{
			const response = await _Request("/api/internal/agent-controller/agent-run-workflows/load", { input, task });
			if (response.status === 409)
			{
				return null;
			}
			if (response.status !== 200)
			{
				throw new Error(`warm AgentRun load failed with HTTP ${response.status}`);
			}
			return await _ReadJson(response, __ParseAgentRunWorkflowControllerRecord);
		},
		async reserveWarmPod(input, task, command) { return await _Binding("/api/internal/agent-controller/agent-run-workflows/warm-reservation", input, task, command); },
		async recordWarmProfileActivation(input, task, command) { return await _Binding("/api/internal/agent-controller/agent-run-workflows/warm-activation", input, task, command); },
		async recordWarmReadiness(input, task, command) { return await _Binding("/api/internal/agent-controller/agent-run-workflows/warm-readiness", input, task, command); },
		async requestWarmPodDeletion(input, task, command) { return await _Binding("/api/internal/agent-controller/agent-run-workflows/warm-delete-request", input, task, command); },
		async recordWarmPodDeleted(input, task, command) { return await _Binding("/api/internal/agent-controller/agent-run-workflows/warm-deleted", input, task, command); },
		async terminalizeFailedTask(input, task): Promise<void>
		{
			const response = await _Request("/api/internal/agent-controller/agent-run-workflows/terminal-failure", { input, task });
			if (response.status !== 204)
			{
				throw new Error(`warm AgentRun terminal failure failed with HTTP ${response.status}`);
			}
		},
		async observe(input, task): Promise<AgentRunWorkflowObservation>
		{
			const response = await _Request("/api/internal/agent-controller/agent-run-workflows/observe", { input, task });
			if (response.status !== 200)
			{
				throw new Error(`warm AgentRun observation failed with HTTP ${response.status}`);
			}
			return await _ReadJson(response, __ParseAgentRunWorkflowObservation);
		},
	};
}
