import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { ___DoWithTrace } from "@opencrane/observability";
import type { AgentControllerRunAttemptAssignmentCommand, AgentControllerRunAttemptAssignmentResult, AgentControllerRunAttemptClaim, AgentControllerRunAttemptClaimLease, AgentControllerRunWorkloadRegistrationCommand, AgentControllerRunWorkloadRegistrationResult, AgentControllerRunWorkloadReleaseClaim } from "@opencrane/contracts";
import { ___ParseAndValidateJson } from "@opencrane/util";

import type { AgentControllerAuthority, AgentControllerFetch, AgentControllerHttpAuthorityOptions, AgentControllerTokenReader } from "./agent-controller.types.js";

/** Maximum JSON response accepted from one internal controller authority call. */
const _MAX_RESPONSE_BYTES = 64 * 1024;

/** Stable internal claim route appended to the configured OpenCrane base URL. */
const _CLAIM_PATH = "/api/internal/agent-controller/run-attempts:claim";

/** Stable internal release route appended to the configured OpenCrane base URL. */
const _RELEASE_CLAIM_PATH = "/api/internal/agent-controller/workload-releases:claim";

/** Stable internal route for bounded retention of successfully published runtime commands. */
const _OUTBOX_PRUNE_PATH = "/api/internal/agent-controller/run-outbox:prune";

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

/** Return whether an untrusted JSON value is a valid ISO instant. */
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
 * Read one bounded controller response and return only the validator-owned domain value.
 *
 * @param response - Internal controller response whose body remains untrusted.
 * @param validate - Domain validator that binds the decoded payload to its expected contract.
 * @param validatorArguments - Request coordinates used to reject mismatched authority responses.
 * @returns The validated response value.
 */
async function _ReadAndValidateJson<T, TArguments extends readonly unknown[]>(response: Response, validate: (candidate: unknown, ...arguments_: TArguments) => T, ...validatorArguments: TArguments): Promise<T>
{
	// 1. Stream the body through the allocation ceiling before retaining or parsing it.
	const text = await _ReadBoundedText(response);

	// 2. Parse and validate in one boundary operation so no untyped payload escapes this adapter.
	return ___ParseAndValidateJson(text, "OpenCrane controller response", validate, ...validatorArguments);
}

/** Read one controller response without allocating beyond its fixed protocol ceiling. */
async function _ReadBoundedText(response: Response): Promise<string>
{
	const declaredLength = response.headers.get("content-length");
	if (declaredLength !== null)
	{
		const parsedLength = Number(declaredLength);
		if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > _MAX_RESPONSE_BYTES)
		{
			await response.body?.cancel();
			throw new Error("OpenCrane controller response exceeded the 64 KiB boundary");
		}
	}
	if (response.body === null) throw new Error("OpenCrane controller returned no response body");

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
			throw new Error("OpenCrane controller response exceeded the 64 KiB boundary");
		}
		chunks.push(result.value);
	}
}

/** Parse one exact database-issued claim generation. */
function _ParseLease(value: unknown): AgentControllerRunAttemptClaimLease
{
	const lease = _AsObject(value);
	if (!lease || !_IsIdentifier(lease.eventId) || !_IsTime(lease.claimedAt) || !_IsPositiveInteger(lease.deliveryCount) || !_IsTime(lease.expiresAt) || Date.parse(lease.claimedAt) >= Date.parse(lease.expiresAt))
	{
		throw new Error("OpenCrane returned a malformed controller claim lease");
	}
	return { eventId: lease.eventId, claimedAt: lease.claimedAt, deliveryCount: lease.deliveryCount, expiresAt: lease.expiresAt };
}

/** Parse the exact desired-state projection returned by the claim endpoint. */
function _ParseClaim(value: unknown): AgentControllerRunAttemptClaim
{
	const root = _AsObject(value);
	const attempt = _AsObject(root?.attempt);
	if (!root || !attempt || !_IsIdentifier(attempt.runId) || !_IsPositiveInteger(attempt.attempt) || !_IsIdentifier(attempt.siloId) || !_IsIdentifier(attempt.agentServiceId) || !_IsIdentifier(attempt.agentRevisionId) || !_IsIdentifier(attempt.inputSnapshotDigest) || !_IsIdentifier(attempt.namespace) || !_IsIdentifier(attempt.workloadProfile) || !_IsIdentifier(attempt.bootstrapReference) || !_IsIdentifier(attempt.litellmKey))
	{
		throw new Error("OpenCrane returned a malformed controller claim");
	}
	// The minted key is transient: it is bound here only long enough for the reconcile to write it
	// into the per-attempt Secret. It is never logged, committed to the assignment, or persisted.
	return {
		lease: _ParseLease(root.lease),
		attempt: { runId: attempt.runId, attempt: attempt.attempt, siloId: attempt.siloId, agentServiceId: attempt.agentServiceId, agentRevisionId: attempt.agentRevisionId, inputSnapshotDigest: attempt.inputSnapshotDigest, namespace: attempt.namespace, workloadProfile: attempt.workloadProfile, bootstrapReference: attempt.bootstrapReference, litellmKey: attempt.litellmKey },
	};
}

/** Parse the exact durable assignment returned by the workload-release claim endpoint. */
function _ParseWorkloadReleaseClaim(value: unknown): AgentControllerRunWorkloadReleaseClaim
{
	const root = _AsObject(value);
	const workload = _AsObject(root?.workload);
	if (!root || !workload || !_IsIdentifier(workload.runId) || !_IsPositiveInteger(workload.attempt) || !_IsIdentifier(workload.siloId) || !_IsIdentifier(workload.agentServiceId) || !_IsIdentifier(workload.agentRevisionId) || !_IsIdentifier(workload.namespace) || !_IsIdentifier(workload.serviceAccountName) || !_IsIdentifier(workload.workloadUid) || !_IsIdentifier(workload.workloadProfile) || !_IsTime(workload.assignmentExpiresAt) || !_IsIdentifier(workload.bootstrapReference))
	{
		throw new Error("OpenCrane returned a malformed workload-release claim");
	}
	return {
		lease: _ParseLease(root.lease),
		workload: {
			runId: workload.runId,
			attempt: workload.attempt,
			siloId: workload.siloId,
			agentServiceId: workload.agentServiceId,
			agentRevisionId: workload.agentRevisionId,
			namespace: workload.namespace,
			serviceAccountName: workload.serviceAccountName,
			workloadUid: workload.workloadUid,
			workloadProfile: workload.workloadProfile,
			assignmentExpiresAt: workload.assignmentExpiresAt,
			bootstrapReference: workload.bootstrapReference,
		},
	};
}

/** Parse an assignment result and bind it back to the exact submitted command. */
function _ParseAssignmentResult(value: unknown, command: AgentControllerRunAttemptAssignmentCommand): AgentControllerRunAttemptAssignmentResult
{
	const root = _AsObject(value);
	if (!root || (root.outcome !== "assigned" && root.outcome !== "idempotent") || root.runId !== command.runId || root.attempt !== command.attempt || root.workloadUid !== command.workloadUid)
	{
		throw new Error("OpenCrane returned a mismatched controller assignment result");
	}
	return { outcome: root.outcome, runId: command.runId, attempt: command.attempt, workloadUid: command.workloadUid };
}

/** Parse a registration result and bind it back to the exact submitted evidence. */
function _ParseRegistrationResult(value: unknown, command: AgentControllerRunWorkloadRegistrationCommand): AgentControllerRunWorkloadRegistrationResult
{
	const root = _AsObject(value);
	if (!root || (root.outcome !== "registered" && root.outcome !== "idempotent") || root.runId !== command.runId || root.attempt !== command.attempt || root.workloadUid !== command.workloadUid || root.podUid !== command.podUid)
	{
		throw new Error("OpenCrane returned a mismatched first-Pod registration result");
	}
	return { outcome: root.outcome, runId: command.runId, attempt: command.attempt, workloadUid: command.workloadUid, podUid: command.podUid };
}

/** Parse the narrow count returned by the controller-only maintenance endpoint. */
function _ParsePrunedCount(value: unknown): number
{
	const root = _AsObject(value);
	if (!root || typeof root.deletedCount !== "number" || !Number.isSafeInteger(root.deletedCount) || root.deletedCount < 0 || root.deletedCount > 1_000)
	{
		throw new Error("OpenCrane returned a malformed outbox-prune result");
	}
	return root.deletedCount;
}

/** Read the latest rotated projected token from its mounted file. */
function _CreateTokenReader(path: string): AgentControllerTokenReader
{
	return async function _readToken(): Promise<string>
	{
		const token = (await readFile(path, "utf8")).trim();
		if (token.length === 0)
		{
			throw new Error("projected agent-controller token is empty");
		}
		return token;
	};
}

/** Build headers for one authenticated JSON authority call. */
function _Headers(token: string): Headers
{
	const headers = new Headers();
	headers.set("authorization", `Bearer ${token}`);
	headers.set("content-type", "application/json");
	headers.set("accept", "application/json");
	return headers;
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
	if (!parsed || parsed.protocol !== "http:" || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "" || parsed.username !== "" || parsed.password !== "")
	{
		throw new Error("OPENCRANE_INTERNAL_URL must be one in-cluster HTTP origin with no path or credentials");
	}
	return parsed;
}

/**
 * Create the projected-token-authenticated OpenCrane desired-state adapter.
 *
 * The token file is reread for every exchange to honour kubelet rotation. Responses are size-bounded
 * and rebound to the submitted run/attempt/UID before the controller may treat them as authority.
 * @param options - Internal URL, rotating token path, timeout, and optional test seams.
 * @returns An authority that claims attempts and commits only exact Job UIDs.
 */
export function __CreateHttpAgentControllerAuthority(options: AgentControllerHttpAuthorityOptions): AgentControllerAuthority
{
	const baseUrl = _BaseUrl(options.openCraneInternalUrl);
	if (!isAbsolute(options.tokenPath) || !Number.isSafeInteger(options.requestTimeoutMilliseconds) || options.requestTimeoutMilliseconds < 1_000 || options.requestTimeoutMilliseconds > 60_000)
	{
		throw new Error("agent controller HTTP authority requires an absolute token path and 1-60s timeout");
	}
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
				return _ReadAndValidateJson(response, _ParseClaim);
			});
		},
		async __CommitAssignment(eventId: string, command: AgentControllerRunAttemptAssignmentCommand, signal: AbortSignal): Promise<AgentControllerRunAttemptAssignmentResult>
		{
			return ___DoWithTrace("agent_controller.assignment.commit", { eventId, runId: command.runId, attempt: command.attempt, workloadUid: command.workloadUid }, async function _commit()
			{
				if (!_IsIdentifier(eventId)) throw new Error("agent controller assignment requires one valid event id");
				const token = await readToken();
				const path = `/api/internal/agent-controller/run-attempts/${encodeURIComponent(eventId)}/assignment`;
				const response = await fetchRequest(new URL(path, baseUrl), { method: "PUT", headers: _Headers(token), body: JSON.stringify(command), signal: _RequestSignal(signal, options.requestTimeoutMilliseconds) });
				if (response.status !== 200) throw new Error(`OpenCrane controller assignment failed with HTTP ${response.status}`);
				return _ReadAndValidateJson(response, _ParseAssignmentResult, command);
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
				return _ReadAndValidateJson(response, _ParseWorkloadReleaseClaim);
			});
		},
		async __RegisterFirstPod(eventId: string, command: AgentControllerRunWorkloadRegistrationCommand, signal: AbortSignal): Promise<AgentControllerRunWorkloadRegistrationResult>
		{
			return ___DoWithTrace("agent_controller.workload_release.register", { eventId, runId: command.runId, attempt: command.attempt, workloadUid: command.workloadUid, podUid: command.podUid }, async function _registerFirstPod()
			{
				if (!_IsIdentifier(eventId)) throw new Error("agent controller registration requires one valid event id");
				const token = await readToken();
				const path = `/api/internal/agent-controller/workload-releases/${encodeURIComponent(eventId)}/registration`;
				const response = await fetchRequest(new URL(path, baseUrl), { method: "PUT", headers: _Headers(token), body: JSON.stringify(command), signal: _RequestSignal(signal, options.requestTimeoutMilliseconds) });
				if (response.status !== 200) throw new Error(`OpenCrane first-Pod registration failed with HTTP ${response.status}`);
				return _ReadAndValidateJson(response, _ParseRegistrationResult, command);
			});
		},
		async __PrunePublishedOutbox(signal: AbortSignal): Promise<number>
		{
			return ___DoWithTrace("agent_controller.outbox.prune", {}, async function _prunePublishedOutbox()
			{
				const token = await readToken();
				const response = await fetchRequest(new URL(_OUTBOX_PRUNE_PATH, baseUrl), { method: "POST", headers: _Headers(token), body: "{}", signal: _RequestSignal(signal, options.requestTimeoutMilliseconds) });
				if (response.status !== 200) throw new Error(`OpenCrane outbox prune failed with HTTP ${response.status}`);
				return _ReadAndValidateJson(response, _ParsePrunedCount);
			});
		},
	};
}
