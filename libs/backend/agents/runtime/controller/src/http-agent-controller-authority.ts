import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ___IsAgentControllerIdentifier, ___ParseAgentControllerOutboxPrunedCount, ___ParseAgentControllerRunAttemptAssignmentResult, ___ParseAgentControllerRunAttemptClaim, ___ParseAgentControllerRunWorkloadRegistrationResult, ___ParseAgentControllerRunWorkloadReleaseClaim, type AgentControllerRunAttemptAssignmentCommand, type AgentControllerRunAttemptAssignmentResult, type AgentControllerRunAttemptClaim, type AgentControllerRunWorkloadRegistrationCommand, type AgentControllerRunWorkloadRegistrationResult, type AgentControllerRunWorkloadReleaseClaim } from "@opencrane/contracts";

import type { AgentControllerAuthority } from "./agent-controller.types.js";
import type { AgentControllerFetch, AgentControllerHttpAuthorityOptions, AgentControllerTokenReader } from "./http-agent-controller-authority.types.js";
import { _ReadAndValidateAgentControllerJson } from "./http-agent-controller-response.js";

const _CLAIM_PATH = "/api/internal/agent-controller/run-attempts:claim";
const _RELEASE_CLAIM_PATH = "/api/internal/agent-controller/workload-releases:claim";
const _OUTBOX_PRUNE_PATH = "/api/internal/agent-controller/run-outbox:prune";

function _CreateTokenReader(path: string): AgentControllerTokenReader
{
	return async function _readToken(): Promise<string>
	{
		const token = (await readFile(path, "utf8")).trim();
		if (token.length === 0) throw new Error("projected agent-controller token is empty");
		return token;
	};
}

function _Headers(token: string): Headers
{
	const headers = new Headers();
	headers.set("authorization", `Bearer ${token}`);
	headers.set("content-type", "application/json");
	headers.set("accept", "application/json");
	return headers;
}

function _RequestSignal(signal: AbortSignal, timeoutMilliseconds: number): AbortSignal
{
	return AbortSignal.any([signal, AbortSignal.timeout(timeoutMilliseconds)]);
}

function _BaseUrl(value: string): URL
{
	const parsed = URL.parse(value);
	if (!parsed || parsed.protocol !== "http:" || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "" || parsed.username !== "" || parsed.password !== "") throw new Error("OPENCRANE_INTERNAL_URL must be one in-cluster HTTP origin with no path or credentials");
	return parsed;
}

/**
 * Create the OpenCrane client the controller talks to, over plain in-cluster HTTP.
 *
 * The token file is re-read on every call, not cached, because Kubernetes rotates a projected
 * token in place. Every response is size-capped and schema-validated before it is returned, and
 * the two commit responses are additionally checked to describe the run, attempt, and UID that
 * were actually submitted — so a mismatched or replayed answer becomes an error instead of being
 * acted on.
 *
 * Called by: `apps/agent-controller/src/index.ts`, which passes the result as
 * `options.authority` to {@link __RunAgentController}.
 * @param options - Internal base URL, token path, request timeout, and test-only overrides.
 * @returns A client satisfying the authority port; each method is documented on the port.
 * @throws At construction, when the base URL is not a plain HTTP origin (no path, query, or
 * credentials), when the token path is not absolute, or when the timeout is outside 1-60s.
 * @see {@link AgentControllerAuthority}
 */
export function __CreateHttpAgentControllerAuthority(options: AgentControllerHttpAuthorityOptions): AgentControllerAuthority
{
	const baseUrl = _BaseUrl(options.openCraneInternalUrl);
	if (!isAbsolute(options.tokenPath) || !Number.isSafeInteger(options.requestTimeoutMilliseconds) || options.requestTimeoutMilliseconds < 1_000 || options.requestTimeoutMilliseconds > 60_000) throw new Error("agent controller HTTP authority requires an absolute token path and 1-60s timeout");
	const fetchRequest: AgentControllerFetch = options.fetch ?? fetch;
	const readToken = options.readToken ?? _CreateTokenReader(options.tokenPath);
	return {
		async __Claim(signal: AbortSignal): Promise<AgentControllerRunAttemptClaim | null>
		{
			return ___DoWithTrace("agent_controller.attempt.claim", {}, async function _claim()
			{
				const token = await readToken();
				const response = await fetchRequest(new URL(_CLAIM_PATH, baseUrl), { method: "POST", headers: _Headers(token), body: "{}", signal: _RequestSignal(signal, options.requestTimeoutMilliseconds) });
				if (response.status === 204) return null;
				if (response.status !== 200) throw new Error(`OpenCrane controller claim failed with HTTP ${response.status}`);
				return _ReadAndValidateAgentControllerJson(response, ___ParseAgentControllerRunAttemptClaim);
			});
		},
		async __CommitAssignment(eventId: string, command: AgentControllerRunAttemptAssignmentCommand, signal: AbortSignal): Promise<AgentControllerRunAttemptAssignmentResult>
		{
			return ___DoWithTrace("agent_controller.assignment.commit", { eventId, runId: command.runId, attempt: command.attempt, workloadUid: command.workloadUid }, async function _commit()
			{
				if (!___IsAgentControllerIdentifier(eventId)) throw new Error("agent controller assignment requires one valid event id");
				const token = await readToken();
				const path = `/api/internal/agent-controller/run-attempts/${encodeURIComponent(eventId)}/assignment`;
				const response = await fetchRequest(new URL(path, baseUrl), { method: "PUT", headers: _Headers(token), body: JSON.stringify(command), signal: _RequestSignal(signal, options.requestTimeoutMilliseconds) });
				if (response.status !== 200) throw new Error(`OpenCrane controller assignment failed with HTTP ${response.status}`);
				return _ReadAndValidateAgentControllerJson(response, ___ParseAgentControllerRunAttemptAssignmentResult, command);
			});
		},
		async __ClaimWorkloadRelease(signal: AbortSignal): Promise<AgentControllerRunWorkloadReleaseClaim | null>
		{
			return ___DoWithTrace("agent_controller.workload_release.claim", {}, async function _claimWorkloadRelease()
			{
				const token = await readToken();
				const response = await fetchRequest(new URL(_RELEASE_CLAIM_PATH, baseUrl), { method: "POST", headers: _Headers(token), body: "{}", signal: _RequestSignal(signal, options.requestTimeoutMilliseconds) });
				if (response.status === 204) return null;
				if (response.status !== 200) throw new Error(`OpenCrane workload-release claim failed with HTTP ${response.status}`);
				return _ReadAndValidateAgentControllerJson(response, ___ParseAgentControllerRunWorkloadReleaseClaim);
			});
		},
		async __RegisterFirstPod(eventId: string, command: AgentControllerRunWorkloadRegistrationCommand, signal: AbortSignal): Promise<AgentControllerRunWorkloadRegistrationResult>
		{
			return ___DoWithTrace("agent_controller.workload_release.register", { eventId, runId: command.runId, attempt: command.attempt, workloadUid: command.workloadUid, podUid: command.podUid }, async function _registerFirstPod()
			{
				if (!___IsAgentControllerIdentifier(eventId)) throw new Error("agent controller registration requires one valid event id");
				const token = await readToken();
				const path = `/api/internal/agent-controller/workload-releases/${encodeURIComponent(eventId)}/registration`;
				const response = await fetchRequest(new URL(path, baseUrl), { method: "PUT", headers: _Headers(token), body: JSON.stringify(command), signal: _RequestSignal(signal, options.requestTimeoutMilliseconds) });
				if (response.status !== 200) throw new Error(`OpenCrane first-Pod registration failed with HTTP ${response.status}`);
				return _ReadAndValidateAgentControllerJson(response, ___ParseAgentControllerRunWorkloadRegistrationResult, command);
			});
		},
		async __PrunePublishedOutbox(signal: AbortSignal): Promise<number>
		{
			return ___DoWithTrace("agent_controller.outbox.prune", {}, async function _prunePublishedOutbox()
			{
				const token = await readToken();
				const response = await fetchRequest(new URL(_OUTBOX_PRUNE_PATH, baseUrl), { method: "POST", headers: _Headers(token), body: "{}", signal: _RequestSignal(signal, options.requestTimeoutMilliseconds) });
				if (response.status !== 200) throw new Error(`OpenCrane outbox prune failed with HTTP ${response.status}`);
				return _ReadAndValidateAgentControllerJson(response, ___ParseAgentControllerOutboxPrunedCount);
			});
		},
	};
}
