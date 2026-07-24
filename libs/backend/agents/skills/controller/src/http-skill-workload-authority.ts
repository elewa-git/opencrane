import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { ___DoWithTrace } from "@opencrane/observability";
import type { AgentControllerSkillWorkloadAssignmentCommand, AgentControllerSkillWorkloadClaim } from "@opencrane/contracts";

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

/** Read one bounded JSON response without trusting its content type alone. */
async function _ReadJson(response: Response): Promise<unknown>
{
	const text = await response.text();
	if (Buffer.byteLength(text, "utf8") > _MAX_RESPONSE_BYTES) throw new Error("OpenCrane skill workload response exceeded the 16 KiB boundary");
	try
	{
		return JSON.parse(text) as unknown;
	}
	catch
	{
		throw new Error("OpenCrane skill workload response was not valid JSON");
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

/** Parse the exact database-fenced release coordinates without accepting controller policy. */
function _ParseReleaseClaim(value: unknown): SkillWorkloadControllerReleaseClaim
{
	const claim = _AsObject(value);
	if (!claim || !_IsIdentifier(claim.workloadId) || !_IsIdentifier(claim.siloId) || (claim.kind !== "authoring" && claim.kind !== "tool-runner") || !_IsIdentifier(claim.workloadUid) || !_IsTime(claim.releaseClaimedAt) || !_IsPositiveInteger(claim.releaseDeliveryCount) || !_IsTime(claim.expiresAt))
	{
		throw new Error("OpenCrane returned a malformed skill workload release claim");
	}
	return { workloadId: claim.workloadId, siloId: claim.siloId, kind: claim.kind, workloadUid: claim.workloadUid, releaseClaimedAt: claim.releaseClaimedAt, releaseDeliveryCount: claim.releaseDeliveryCount, expiresAt: claim.expiresAt };
}

/** Parse a release or Pod-registration result tied to every submitted immutable coordinate. */
function _ParseReleaseResult(value: unknown, workloadId: string, command: SkillWorkloadControllerReleaseCommand, podUid?: string): "released" | "registered" | "idempotent"
{
	const result = _AsObject(value);
	const outcomeIsValid = result?.outcome === "released" || result?.outcome === "registered" || result?.outcome === "idempotent";
	if (!result || result.workloadId !== workloadId || result.workloadUid !== command.workloadUid || (podUid !== undefined && result.podUid !== podUid) || !outcomeIsValid)
	{
		throw new Error("OpenCrane returned a mismatched skill workload release result");
	}
	if (result.outcome === "released" || result.outcome === "registered" || result.outcome === "idempotent") return result.outcome;
	throw new Error("OpenCrane returned an invalid skill workload release outcome");
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
				return _ParseClaim(await _ReadJson(response));
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
				return _ParseAssignment(await _ReadJson(response), workloadId, command);
			});
		},
		async __ClaimRelease(signal: AbortSignal): Promise<SkillWorkloadControllerReleaseClaim | null>
		{
			return ___DoWithTrace("agent_controller.skill_workload.release_claim", {}, async function _ClaimRelease(): Promise<SkillWorkloadControllerReleaseClaim | null>
			{
				const response = await fetchRequest(new URL("/api/internal/agent-controller/skill-workloads:release-claim", baseUrl), { method: "POST", headers: _Headers(await readToken()), body: "{}", signal: _RequestSignal(signal, options.requestTimeoutMilliseconds) });
				if (response.status === 204) return null;
				if (response.status !== 200) throw new Error(`OpenCrane skill workload release claim failed with HTTP ${response.status}`);
				return _ParseReleaseClaim(await _ReadJson(response));
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
				const outcome = _ParseReleaseResult(await _ReadJson(response), workloadId, command);
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
				const outcome = _ParseReleaseResult(await _ReadJson(response), workloadId, command, command.podUid);
				if (outcome === "released") throw new Error("OpenCrane returned a Job-release outcome for Pod registration");
				return outcome;
			});
		},
	};
}
