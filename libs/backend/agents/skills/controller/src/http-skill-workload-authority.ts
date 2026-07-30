import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { ___DoWithTrace } from "@opencrane/observability";
import type { AgentControllerSkillWorkloadAssignmentCommand, AgentControllerSkillWorkloadClaim } from "@opencrane/contracts";
import { ___ParseAndValidateJson } from "@opencrane/util";

import type { SkillWorkloadControllerAuthority, SkillWorkloadControllerFetch, SkillWorkloadControllerHttpAuthorityOptions, SkillWorkloadControllerPodRegistrationCommand, SkillWorkloadControllerReleaseClaim, SkillWorkloadControllerReleaseCommand, SkillWorkloadControllerTokenReader } from "./skill-workload-controller.types.js";

/** Maximum JSON response accepted from one internal controller authority call. */
const _MAX_RESPONSE_BYTES = 16 * 1024;

/** Stable internal route appended to the configured OpenCrane base URL. */
const _CLAIM_PATH = "/api/internal/agent-controller/skill-workloads:claim";

/** Return whether an untrusted JSON value is a non-empty bounded identifier. */
function _IsIdentifier(value: unknown): value is string
{
	return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Return whether an untrusted JSON value is a positive safe integer. */
function _IsPositiveInteger(value: unknown): value is number
{
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Return whether an untrusted JSON value is one canonical ISO UTC instant. */
function _IsTime(value: unknown): value is string
{
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
	const epochMilliseconds = Date.parse(value);
	return Number.isSafeInteger(epochMilliseconds) && new Date(epochMilliseconds).toISOString() === value;
}

/** Return a plain object suitable for security-boundary parsing. */
function _AsObject(value: unknown): Record<string, unknown> | null
{
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * Read one bounded skill-workload response and return only its validator-owned domain value.
 *
 * @param response - Internal authority response whose body remains untrusted.
 * @param validate - Domain validator that binds the decoded payload to its expected contract.
 * @param validatorArguments - Request coordinates used to reject mismatched authority responses.
 * @returns The validated response value.
 */
async function _ReadAndValidateJson<T, TArguments extends readonly unknown[]>(response: Response, validate: (candidate: unknown, ...arguments_: TArguments) => T, ...validatorArguments: TArguments): Promise<T>
{
	// 1. Stream the body through the allocation ceiling before retaining or parsing it.
	const text = await _ReadBoundedText(response);

	// 2. Parse and validate together so no untyped authority response leaves this adapter.
	return ___ParseAndValidateJson(text, "OpenCrane skill workload response", validate, ...validatorArguments);
}

/** Read one skill-workload response without allocating beyond its fixed protocol ceiling. */
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

/** Parse one exact database-issued governed skill workload claim. */
function _ParseClaim(value: unknown): AgentControllerSkillWorkloadClaim
{
	const claim = _AsObject(value);
	if (!claim || !_IsIdentifier(claim.workloadId) || !_IsIdentifier(claim.siloId) || (claim.kind !== "authoring" && claim.kind !== "tool-runner") || !_IsIdentifier(claim.skillRevisionId) || !_IsTime(claim.claimedAt) || !_IsPositiveInteger(claim.deliveryCount) || !_IsTime(claim.expiresAt) || Date.parse(claim.claimedAt) >= Date.parse(claim.expiresAt))
	{
		throw new Error("OpenCrane returned a malformed skill workload claim");
	}
	return { workloadId: claim.workloadId, siloId: claim.siloId, kind: claim.kind, skillRevisionId: claim.skillRevisionId, claimedAt: claim.claimedAt, deliveryCount: claim.deliveryCount, expiresAt: claim.expiresAt };
}

/** Parse a commit result and bind it to the exact submitted workload and Job UID. */
function _ParseAssignment(value: unknown, workloadId: string, command: AgentControllerSkillWorkloadAssignmentCommand): "assigned" | "idempotent" | "conflict"
{
	const result = _AsObject(value);
	if (!result || result.workloadId !== workloadId || result.workloadUid !== command.workloadUid || (result.outcome !== "assigned" && result.outcome !== "idempotent"))
	{
		throw new Error("OpenCrane returned a mismatched skill workload assignment result");
	}
	return result.outcome;
}

/** Parse the exact release coordinates issued by the authority database. */
function _ParseReleaseClaim(value: unknown): SkillWorkloadControllerReleaseClaim
{
	const claim = _AsObject(value);
	if (!claim || !_IsIdentifier(claim.workloadId) || !_IsIdentifier(claim.siloId) || (claim.kind !== "authoring" && claim.kind !== "tool-runner") || !_IsIdentifier(claim.workloadUid) || !_IsTime(claim.releaseClaimedAt) || !_IsPositiveInteger(claim.releaseDeliveryCount) || !_IsTime(claim.expiresAt) || Date.parse(claim.releaseClaimedAt) >= Date.parse(claim.expiresAt)) throw new Error("OpenCrane returned a malformed skill workload release claim");
	return { workloadId: claim.workloadId, siloId: claim.siloId, kind: claim.kind, workloadUid: claim.workloadUid, releaseClaimedAt: claim.releaseClaimedAt, releaseDeliveryCount: claim.releaseDeliveryCount, expiresAt: claim.expiresAt };
}

/** Parse a release or registration response bound to its submitted immutable evidence. */
function _ParseReleaseResult(value: unknown, workloadId: string, command: SkillWorkloadControllerReleaseCommand, podUid?: string): "released" | "registered" | "idempotent"
{
	const result = _AsObject(value);
	if (!result || result.workloadId !== workloadId || result.workloadUid !== command.workloadUid || (podUid !== undefined && result.podUid !== podUid) || (result.outcome !== "released" && result.outcome !== "registered" && result.outcome !== "idempotent")) throw new Error("OpenCrane returned a mismatched skill workload release result");
	return result.outcome;
}

/** Read the latest rotated projected token from its mounted file. */
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

/** Combine process cancellation with the hard per-request timeout. */
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

/** Create the projected-token-authenticated governed skill desired-state and assignment adapter. */
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
				return _ReadAndValidateJson(response, _ParseClaim);
			});
		},
		async __CommitAssignment(workloadId: string, command: AgentControllerSkillWorkloadAssignmentCommand, signal: AbortSignal): Promise<"assigned" | "idempotent" | "conflict">
		{
			return ___DoWithTrace("agent_controller.skill_workload.assignment", { workloadId, workloadUid: command.workloadUid }, async function _CommitAssignment(): Promise<"assigned" | "idempotent" | "conflict">
			{
				if (!_IsIdentifier(workloadId)) throw new Error("skill workload assignment requires one valid workload id");
				const path = `/api/internal/agent-controller/skill-workloads/${encodeURIComponent(workloadId)}/assignment`;
				const response = await fetchRequest(new URL(path, baseUrl), { method: "PUT", headers: _Headers(await readToken()), body: JSON.stringify(command), signal: _RequestSignal(signal, options.requestTimeoutMilliseconds) });
				if (response.status === 409) return "conflict";
				if (response.status !== 200) throw new Error(`OpenCrane skill workload assignment failed with HTTP ${response.status}`);
				return _ReadAndValidateJson(response, _ParseAssignment, workloadId, command);
			});
		},
		async __ClaimRelease(signal: AbortSignal): Promise<SkillWorkloadControllerReleaseClaim | null>
		{
			return ___DoWithTrace("agent_controller.skill_workload.release_claim", {}, async function _ClaimRelease(): Promise<SkillWorkloadControllerReleaseClaim | null>
			{
				const response = await fetchRequest(new URL("/api/internal/agent-controller/skill-workloads:release-claim", baseUrl), { method: "POST", headers: _Headers(await readToken()), body: "{}", signal: _RequestSignal(signal, options.requestTimeoutMilliseconds) });
				if (response.status === 204) return null;
				if (response.status !== 200) throw new Error(`OpenCrane skill workload release claim failed with HTTP ${response.status}`);
				return _ReadAndValidateJson(response, _ParseReleaseClaim);
			});
		},
		async __CommitRelease(workloadId: string, command: SkillWorkloadControllerReleaseCommand, signal: AbortSignal): Promise<"released" | "idempotent" | "conflict">
		{
			return ___DoWithTrace("agent_controller.skill_workload.release", { workloadId, workloadUid: command.workloadUid }, async function _CommitRelease(): Promise<"released" | "idempotent" | "conflict">
			{
				if (!_IsIdentifier(workloadId)) throw new Error("skill workload release requires one valid workload id");
				const response = await fetchRequest(new URL(`/api/internal/agent-controller/skill-workloads/${encodeURIComponent(workloadId)}/release`, baseUrl), { method: "PUT", headers: _Headers(await readToken()), body: JSON.stringify(command), signal: _RequestSignal(signal, options.requestTimeoutMilliseconds) });
				if (response.status === 409) return "conflict";
				if (response.status !== 200) throw new Error(`OpenCrane skill workload release failed with HTTP ${response.status}`);
				const outcome = await _ReadAndValidateJson(response, _ParseReleaseResult, workloadId, command);
				if (outcome === "registered") throw new Error("OpenCrane returned a Pod-registration outcome for a Job release");
				return outcome;
			});
		},
		async __RegisterFirstPod(workloadId: string, command: SkillWorkloadControllerPodRegistrationCommand, signal: AbortSignal): Promise<"registered" | "idempotent" | "conflict">
		{
			return ___DoWithTrace("agent_controller.skill_workload.pod_registration", { workloadId, workloadUid: command.workloadUid, podUid: command.podUid }, async function _RegisterFirstPod(): Promise<"registered" | "idempotent" | "conflict">
			{
				if (!_IsIdentifier(workloadId) || !_IsIdentifier(command.podUid)) throw new Error("skill workload Pod registration requires valid workload and Pod identifiers");
				const response = await fetchRequest(new URL(`/api/internal/agent-controller/skill-workloads/${encodeURIComponent(workloadId)}/pod-registration`, baseUrl), { method: "PUT", headers: _Headers(await readToken()), body: JSON.stringify(command), signal: _RequestSignal(signal, options.requestTimeoutMilliseconds) });
				if (response.status === 409) return "conflict";
				if (response.status !== 200) throw new Error(`OpenCrane skill workload Pod registration failed with HTTP ${response.status}`);
				const outcome = await _ReadAndValidateJson(response, _ParseReleaseResult, workloadId, command, command.podUid);
				if (outcome === "released") throw new Error("OpenCrane returned a Job-release outcome for Pod registration");
				return outcome;
			});
		},
	};
}
