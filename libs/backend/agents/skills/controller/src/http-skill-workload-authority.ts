import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { ___IsAgentControllerIdentifier, ___ParseAgentControllerSkillWorkloadAssignmentResult, ___ParseAgentControllerSkillWorkloadClaim, ___ParseAgentControllerSkillWorkloadPodRegistrationResult, ___ParseAgentControllerSkillWorkloadReleaseClaim, ___ParseAgentControllerSkillWorkloadReleaseResult, type AgentControllerSkillWorkloadAssignmentCommand, type AgentControllerSkillWorkloadClaim, type AgentControllerSkillWorkloadPodRegistrationCommand, type AgentControllerSkillWorkloadReleaseClaim, type AgentControllerSkillWorkloadReleaseCommand } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ___ParseAndValidateJson } from "@opencrane/util";

import type { SkillWorkloadControllerAuthority, SkillWorkloadControllerFetch, SkillWorkloadControllerHttpAuthorityOptions, SkillWorkloadControllerTokenReader } from "./skill-workload-controller.types.js";

/** Maximum JSON response accepted from one internal controller authority call. */
const _MAX_RESPONSE_BYTES = 16 * 1024;

/** Stable internal route appended to the configured OpenCrane base URL. */
const _CLAIM_PATH = "/api/internal/agent-controller/skill-workloads:claim";

/**
 * Read a size-limited response body and return only the value its validator accepted.
 *
 * @param response - Response from the OpenCrane server; its body is not trusted.
 * @param validate - Checks the decoded JSON against the expected contract and returns the typed value.
 * @param validatorArguments - The ids from the request, so a response about a different workload is rejected.
 * @returns The validated response value.
 */
async function _ReadAndValidateJson<T, TArguments extends readonly unknown[]>(response: Response, validate: (candidate: unknown, ...arguments_: TArguments) => T, ...validatorArguments: TArguments): Promise<T>
{
	// 1. Read the body in chunks and stop at the size limit, before keeping or parsing any of it.
	const text = await _ReadBoundedText(response);

	// 2. Parse and check in one step, so no unchecked response leaves this adapter.
	return ___ParseAndValidateJson(text, "OpenCrane skill workload response", validate, ...validatorArguments);
}

/** Read a response body, failing as soon as it goes past the 16 KiB limit. */
async function _ReadBoundedText(response: Response): Promise<string>
{
	const declaredLength = response.headers.get("content-length");
	if (declaredLength !== null)
	{
		const parsedLength = Number(declaredLength);
		if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > _MAX_RESPONSE_BYTES)
		{
			await response.body?.cancel();
			throw new Error("OpenCrane skill workload response exceeded the 16 KiB boundary");
		}
	}
	if (response.body === null) throw new Error("OpenCrane skill workload authority returned no response body");

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	while (true)
	{
		const result = await reader.read();
		if (result.done) return Buffer.concat(chunks, byteLength).toString("utf8");
		byteLength += result.value.byteLength;
		if (byteLength > _MAX_RESPONSE_BYTES)
		{
			await reader.cancel();
			throw new Error("OpenCrane skill workload response exceeded the 16 KiB boundary");
		}
		chunks.push(result.value);
	}
}

/** Read the current token from the file Kubernetes rotates. */
function _CreateTokenReader(path: string): SkillWorkloadControllerTokenReader
{
	return async function _ReadToken(): Promise<string>
	{
		const token = (await readFile(path, "utf8")).trim();
		if (token.length === 0) throw new Error("projected agent-controller token is empty");
		return token;
	};
}

/** Build headers for one authenticated JSON authority call. */
function _Headers(token: string): Headers
{
	return new Headers({ authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" });
}

/** Return a signal that aborts when the process shuts down or when the request times out. */
function _RequestSignal(signal: AbortSignal, timeoutMilliseconds: number): AbortSignal
{
	return AbortSignal.any([signal, AbortSignal.timeout(timeoutMilliseconds)]);
}

/** Validate and normalize the internal OpenCrane origin. */
function _BaseUrl(value: string): URL
{
	const parsed = URL.parse(value);
	if (!parsed || parsed.protocol !== "http:" || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "" || parsed.username !== "" || parsed.password !== "") throw new Error("OPENCRANE_INTERNAL_URL must be one in-cluster HTTP origin with no path or credentials");
	return parsed;
}

/** Create the adapter that asks the OpenCrane server for claims and records assignments, authenticating with the projected token. */
export function __CreateHttpSkillWorkloadControllerAuthority(options: SkillWorkloadControllerHttpAuthorityOptions): SkillWorkloadControllerAuthority
{
	const baseUrl = _BaseUrl(options.openCraneInternalUrl);
	if (!isAbsolute(options.tokenPath) || !Number.isSafeInteger(options.requestTimeoutMilliseconds) || options.requestTimeoutMilliseconds < 1_000 || options.requestTimeoutMilliseconds > 60_000)
	{
		throw new Error("skill workload HTTP authority requires an absolute token path and 1-60s timeout");
	}
	const fetchRequest: SkillWorkloadControllerFetch = options.fetch ?? fetch;
	const readToken = options.readToken ?? _CreateTokenReader(options.tokenPath);
	return {
		async __Claim(signal: AbortSignal): Promise<AgentControllerSkillWorkloadClaim | null>
		{
			return ___DoWithTrace("agent_controller.skill_workload.claim", {}, async function _Claim(): Promise<AgentControllerSkillWorkloadClaim | null>
			{
				const response = await fetchRequest(new URL(_CLAIM_PATH, baseUrl), { method: "POST", headers: _Headers(await readToken()), body: "{}", signal: _RequestSignal(signal, options.requestTimeoutMilliseconds) });
				if (response.status === 204) return null;
				if (response.status !== 200) throw new Error(`OpenCrane skill workload claim failed with HTTP ${response.status}`);
				return _ReadAndValidateJson(response, ___ParseAgentControllerSkillWorkloadClaim);
			});
		},
		async __CommitAssignment(workloadId: string, command: AgentControllerSkillWorkloadAssignmentCommand, signal: AbortSignal): Promise<"assigned" | "idempotent" | "conflict">
		{
			return ___DoWithTrace("agent_controller.skill_workload.assignment", { workloadId, workloadUid: command.workloadUid }, async function _CommitAssignment(): Promise<"assigned" | "idempotent" | "conflict">
			{
				if (!___IsAgentControllerIdentifier(workloadId)) throw new Error("skill workload assignment requires one valid workload id");
				const path = `/api/internal/agent-controller/skill-workloads/${encodeURIComponent(workloadId)}/assignment`;
				const response = await fetchRequest(new URL(path, baseUrl), { method: "PUT", headers: _Headers(await readToken()), body: JSON.stringify(command), signal: _RequestSignal(signal, options.requestTimeoutMilliseconds) });
				if (response.status === 409) return "conflict";
				if (response.status !== 200) throw new Error(`OpenCrane skill workload assignment failed with HTTP ${response.status}`);
				return (await _ReadAndValidateJson(response, ___ParseAgentControllerSkillWorkloadAssignmentResult, workloadId, command)).outcome;
			});
		},
		async __ClaimRelease(signal: AbortSignal): Promise<AgentControllerSkillWorkloadReleaseClaim | null>
		{
			return ___DoWithTrace("agent_controller.skill_workload.release_claim", {}, async function _ClaimRelease(): Promise<AgentControllerSkillWorkloadReleaseClaim | null>
			{
				const response = await fetchRequest(new URL("/api/internal/agent-controller/skill-workloads:release-claim", baseUrl), { method: "POST", headers: _Headers(await readToken()), body: "{}", signal: _RequestSignal(signal, options.requestTimeoutMilliseconds) });
				if (response.status === 204) return null;
				if (response.status !== 200) throw new Error(`OpenCrane skill workload release claim failed with HTTP ${response.status}`);
				return _ReadAndValidateJson(response, ___ParseAgentControllerSkillWorkloadReleaseClaim);
			});
		},
		async __CommitRelease(workloadId: string, command: AgentControllerSkillWorkloadReleaseCommand, signal: AbortSignal): Promise<"released" | "idempotent" | "conflict">
		{
			return ___DoWithTrace("agent_controller.skill_workload.release", { workloadId, workloadUid: command.workloadUid }, async function _CommitRelease(): Promise<"released" | "idempotent" | "conflict">
			{
				if (!___IsAgentControllerIdentifier(workloadId)) throw new Error("skill workload release requires one valid workload id");
				const response = await fetchRequest(new URL(`/api/internal/agent-controller/skill-workloads/${encodeURIComponent(workloadId)}/release`, baseUrl), { method: "PUT", headers: _Headers(await readToken()), body: JSON.stringify(command), signal: _RequestSignal(signal, options.requestTimeoutMilliseconds) });
				if (response.status === 409) return "conflict";
				if (response.status !== 200) throw new Error(`OpenCrane skill workload release failed with HTTP ${response.status}`);
				return (await _ReadAndValidateJson(response, ___ParseAgentControllerSkillWorkloadReleaseResult, workloadId, command)).outcome;
			});
		},
		async __RegisterFirstPod(workloadId: string, command: AgentControllerSkillWorkloadPodRegistrationCommand, signal: AbortSignal): Promise<"registered" | "idempotent" | "conflict">
		{
			return ___DoWithTrace("agent_controller.skill_workload.pod_registration", { workloadId, workloadUid: command.workloadUid, podUid: command.podUid }, async function _RegisterFirstPod(): Promise<"registered" | "idempotent" | "conflict">
			{
				if (!___IsAgentControllerIdentifier(workloadId) || !___IsAgentControllerIdentifier(command.podUid)) throw new Error("skill workload Pod registration requires valid workload and Pod identifiers");
				const response = await fetchRequest(new URL(`/api/internal/agent-controller/skill-workloads/${encodeURIComponent(workloadId)}/pod-registration`, baseUrl), { method: "PUT", headers: _Headers(await readToken()), body: JSON.stringify(command), signal: _RequestSignal(signal, options.requestTimeoutMilliseconds) });
				if (response.status === 409) return "conflict";
				if (response.status !== 200) throw new Error(`OpenCrane skill workload Pod registration failed with HTTP ${response.status}`);
				return (await _ReadAndValidateJson(response, ___ParseAgentControllerSkillWorkloadPodRegistrationResult, workloadId, command)).outcome;
			});
		},
	};
}
