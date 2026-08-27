import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { __ParseAgentRunWorkflowAttemptKey, __ParseAgentRunWorkflowBindingOutcome, __ParseAgentRunWorkflowControllerRecord, __ParseAgentRunWorkflowObservation, __ParseAgentRunWorkflowReleaseClaim, type AgentRunTaskInput, type AgentRunWorkflowAssignmentCommand, type AgentRunWorkflowAttemptKey, type AgentRunWorkflowControllerAuthority, type AgentRunWorkflowControllerRecord, type AgentRunWorkflowObservation, type AgentRunWorkflowPodCommand, type AgentRunWorkflowReleaseClaim } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ___ParseAndValidateJson } from "@opencrane/util";

import type { AgentRunWorkflowControllerFetch, AgentRunWorkflowControllerHttpAuthorityOptions, AgentRunWorkflowControllerTokenReader } from "./agent-run-workflow-http-authority.types";

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

/**
 * Creates the internal server authority used by the controller-hosted AgentRun workflow handler.
 *
 * The configured origin must name the same-silo OpenCrane Service before this adapter reads the
 * controller token. Each request carries the admitted task receipt, while response validators keep
 * a wrong run, profile, or terminal value from becoming controller work.
 *
 * Called by: `apps/agent-controller/src/index.ts` when it registers the AgentRun workflow handler.
 * @param options - Supplies the trusted server origin, rotating token, timeout, and test seams.
 * @returns The controller authority that reads and advances only the admitted task's lifecycle.
 */
export function __CreateHttpAgentRunWorkflowControllerAuthority(options: AgentRunWorkflowControllerHttpAuthorityOptions): AgentRunWorkflowControllerAuthority
{
	const baseUrl = _BaseUrl(options.openCraneInternalUrl, options.serverServiceName, options.serverNamespace);
	if (!isAbsolute(options.tokenPath) || !Number.isSafeInteger(options.requestTimeoutMilliseconds) || options.requestTimeoutMilliseconds < 1_000 || options.requestTimeoutMilliseconds > 60_000)
	{
		throw new Error("AgentRun workflow HTTP authority requires an absolute token path and 1-60s timeout");
	}
	const fetchRequest: AgentRunWorkflowControllerFetch = options.fetch ?? fetch;
	const readToken = options.readToken ?? _CreateTokenReader(options.tokenPath);

	async function _Request(path: string, body: unknown): Promise<Response>
	{
		return await fetchRequest(new URL(path, baseUrl), { method: "POST", headers: _Headers(await readToken()), body: JSON.stringify(body), signal: _RequestSignal(options.shutdownSignal, options.requestTimeoutMilliseconds) });
	}

	return {
		async loadForTask(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<AgentRunWorkflowControllerRecord | null>
		{
			return await ___DoWithTrace("agent_controller.agent_run_workflow.load", { runId: input.runId, attempt: input.attempt }, async function _Load(): Promise<AgentRunWorkflowControllerRecord | null>
			{
				const response = await _Request("/api/internal/agent-controller/agent-run-workflows/load", { input, task });
				if (response.status === 409)
				{
					return null;
				}
				if (response.status !== 200)
				{
					throw new Error(`OpenCrane AgentRun workflow load failed with HTTP ${response.status}`);
				}
				return await _ReadJson(response, __ParseAgentRunWorkflowControllerRecord);
			});
		},
		async mintAttemptKey(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<AgentRunWorkflowAttemptKey | null>
		{
			return await ___DoWithTrace("agent_controller.agent_run_workflow.mint_attempt_key", { runId: input.runId, attempt: input.attempt }, async function _Mint(): Promise<AgentRunWorkflowAttemptKey | null>
			{
				const response = await _Request("/api/internal/agent-controller/agent-run-workflows/mint-attempt-key", { input, task });
				if (response.status === 409)
				{
					return null;
				}
				if (response.status !== 200)
				{
					throw new Error(`OpenCrane AgentRun workflow key mint failed with HTTP ${response.status}`);
				}
				return await _ReadJson(response, __ParseAgentRunWorkflowAttemptKey);
			});
		},
		async revokeAttemptKey(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, attemptKey: AgentRunWorkflowAttemptKey): Promise<void>
		{
			return await ___DoWithTrace("agent_controller.agent_run_workflow.revoke_attempt_key", { runId: input.runId, attempt: input.attempt, keyAlias: attemptKey.keyAlias }, async function _Revoke(): Promise<void>
			{
				const response = await _Request("/api/internal/agent-controller/agent-run-workflows/revoke-attempt-key", { input, task, attemptKey });
				if (response.status !== 204)
				{
					throw new Error(`OpenCrane AgentRun workflow key revocation failed with HTTP ${response.status}`);
				}
			});
		},
		async bindAssignment(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, command: AgentRunWorkflowAssignmentCommand): Promise<"bound" | "idempotent" | "conflict">
		{
			return await _BindingRequest("/api/internal/agent-controller/agent-run-workflows/assignment", input, task, command, fetchRequest, readToken, baseUrl, options);
		},
		async bindFirstPod(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, command: AgentRunWorkflowPodCommand): Promise<"bound" | "idempotent" | "conflict">
		{
			return await _BindingRequest("/api/internal/agent-controller/agent-run-workflows/first-pod", input, task, command, fetchRequest, readToken, baseUrl, options);
		},
		async claimRelease(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, workloadUid: string): Promise<AgentRunWorkflowReleaseClaim | null>
		{
			return await ___DoWithTrace("agent_controller.agent_run_workflow.release_claim", { runId: input.runId, attempt: input.attempt, workloadUid }, async function _ClaimRelease(): Promise<AgentRunWorkflowReleaseClaim | null>
			{
				const response = await _Request("/api/internal/agent-controller/agent-run-workflows/release-claim", { input, task, workloadUid });
				if (response.status === 409)
				{
					return null;
				}
				if (response.status !== 200)
				{
					throw new Error(`OpenCrane AgentRun workflow release claim failed with HTTP ${response.status}`);
				}
				return await _ReadJson(response, __ParseAgentRunWorkflowReleaseClaim);
			});
		},
		async terminalizeFailedTask(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<void>
		{
			return await ___DoWithTrace("agent_controller.agent_run_workflow.terminal_failure", { runId: input.runId, attempt: input.attempt }, async function _TerminalFailure(): Promise<void>
			{
				const response = await _Request("/api/internal/agent-controller/agent-run-workflows/terminal-failure", { input, task });
				if (response.status !== 204)
				{
					throw new Error(`OpenCrane AgentRun workflow terminal failure failed with HTTP ${response.status}`);
				}
			});
		},
		async observe(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<AgentRunWorkflowObservation>
		{
			return await ___DoWithTrace("agent_controller.agent_run_workflow.observe", { runId: input.runId, attempt: input.attempt }, async function _Observe(): Promise<AgentRunWorkflowObservation>
			{
				const response = await _Request("/api/internal/agent-controller/agent-run-workflows/observe", { input, task });
				if (response.status !== 200)
				{
					throw new Error(`OpenCrane AgentRun workflow observation failed with HTTP ${response.status}`);
				}
				return await _ReadJson(response, __ParseAgentRunWorkflowObservation);
			});
		},
	};
}

/** Sends one binding command and maps an authority conflict to the handler's stop outcome. */
async function _BindingRequest(commandPath: string, input: AgentRunTaskInput, task: IWorkflowTaskReceipt, command: AgentRunWorkflowAssignmentCommand | AgentRunWorkflowPodCommand, fetchRequest: AgentRunWorkflowControllerFetch, readToken: AgentRunWorkflowControllerTokenReader, baseUrl: URL, options: AgentRunWorkflowControllerHttpAuthorityOptions): Promise<"bound" | "idempotent" | "conflict">
{
	return await ___DoWithTrace("agent_controller.agent_run_workflow.binding", { runId: input.runId, attempt: input.attempt, workloadUid: command.workloadUid }, async function _Bind(): Promise<"bound" | "idempotent" | "conflict">
	{
		const response = await fetchRequest(new URL(commandPath, baseUrl), { method: "PUT", headers: _Headers(await readToken()), body: JSON.stringify({ input, task, command }), signal: _RequestSignal(options.shutdownSignal, options.requestTimeoutMilliseconds) });
		if (response.status === 409)
		{
			return "conflict";
		}
		if (response.status !== 200)
		{
			throw new Error(`OpenCrane AgentRun workflow binding failed with HTTP ${response.status}`);
		}
		return await _ReadJson(response, __ParseAgentRunWorkflowBindingOutcome);
	});
}
