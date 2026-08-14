import { json, Router, type Response } from "express";

import { AGENT_RUNTIME_PROTOCOL_V1, RuntimeCandidateKinds, ___ParseRuntimeElicitationCandidate, type RuntimeCandidate, type RuntimeStreamOpen } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import type { RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";

import { RuntimeCommandWakeup } from "./runtime-command-wakeup";
import type { RuntimeCandidateAdmission, RuntimeStreamTransportOptions } from "./agent-runtime-stream.types";

/** Validate a bounded runtime instance identifier without accepting executable syntax. */
function _IsRuntimeInstanceId(value: unknown): value is string
{
	return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{7,127}$/.test(value);
}

/** Validate a Kubernetes UID without accepting arbitrary unbounded caller input. */
function _IsPodUid(value: unknown): value is string
{
	return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
}

/** Parse only the fields a stream-open message may carry at this transport boundary. */
function _ParseStreamOpen(value: unknown): RuntimeStreamOpen | null
{
	if (!value || typeof value !== "object")
	{
		return null;
	}
	const candidate = value as Partial<RuntimeStreamOpen>;
	return candidate.protocolVersion === AGENT_RUNTIME_PROTOCOL_V1 && _IsRuntimeInstanceId(candidate.runtimeInstanceId) && _IsPodUid(candidate.podUid)
		? { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId: candidate.runtimeInstanceId, podUid: candidate.podUid }
		: null;
}

/** Extract the bearer credential without exposing it to tracing or structured logs. */
function _ReadBearerToken(value: string | undefined): string | null
{
	if (!value?.startsWith("Bearer "))
	{
		return null;
	}
	const token = value.slice("Bearer ".length).trim();
	return token.length > 0 ? token : null;
}

/** Check that a request body has the candidate fields this transport needs before it can be forwarded — shape only, no permission or fence checks. */
function _IsRuntimeCandidate(value: unknown): value is RuntimeCandidate
{
	if (!value || typeof value !== "object")
	{
		return false;
	}
	const candidate = value as Partial<RuntimeCandidate>;
	const hasCoordinates = candidate.protocolVersion === AGENT_RUNTIME_PROTOCOL_V1
		&& _IsRuntimeInstanceId(candidate.runtimeInstanceId)
		&& typeof candidate.commandId === "string" && candidate.commandId.length > 0
		&& typeof candidate.candidateId === "string" && candidate.candidateId.length > 0
		&& typeof candidate.runId === "string" && candidate.runId.length > 0
		&& typeof candidate.attempt === "number" && Number.isSafeInteger(candidate.attempt) && candidate.attempt >= 0
		&& typeof candidate.fence === "number" && Number.isSafeInteger(candidate.fence) && candidate.fence >= 0;
	if (!hasCoordinates)
	{
		return false;
	}
	if (candidate.kind === "event")
	{
		return typeof candidate.eventType === "string" && candidate.eventType.length > 0 && "payload" in candidate;
	}
	if (candidate.kind === RuntimeCandidateKinds.Elicitation)
	{
		return ___ParseRuntimeElicitationCandidate(value) !== null;
	}
	return candidate.kind === "external_action"
		&& typeof candidate.toolRevisionId === "string" && candidate.toolRevisionId.length > 0
		&& typeof candidate.toolInvocationId === "string" && candidate.toolInvocationId.length > 0
		&& typeof candidate.argumentsDigest === "string" && candidate.argumentsDigest.length > 0
		&& "arguments" in candidate;
}

/**
 * Hand the bearer token to the reviewer and return the identity it verified, or null.
 *
 * Null covers every failure without distinction: no header, an unparseable header, a
 * rejected token, or the wrong audience. That is on purpose — the caller turns any null
 * into the same bare 401, so a caller cannot probe which part was wrong and learn which
 * ServiceAccounts or audiences exist.
 */
async function _AuthenticateRuntime(
	token: string | null,
	options: RuntimeStreamTransportOptions,
): Promise<RuntimeWorkloadIdentity | null>
{
	if (!token)
	{
		return null;
	}
	return options.tokenReviewer.__Review(token);
}

/**
 * Write one server-sent event: an `event:` line naming the type and a `data:` line holding
 * the JSON. It checks nothing, so callers must have validated and size-bounded whatever
 * they pass.
 */
function _WriteEvent(response: Response, event: string, data: unknown): void
{
	response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Build the internal router that agent runtimes connect OUT to. Two routes:
 *
 *   - `POST /stream` — the runtime opens a long-lived server-sent-event stream. After
 *     TokenReview, and after checking that the Pod UID in the body matches the one
 *     Kubernetes attached to the token, the handler loops: read the next command from
 *     Postgres, write it as a `command` event, and otherwise sleep until a local wake-up
 *     or the recovery deadline. A command whose sequence is not higher than the last one
 *     sent ends the stream with a `protocol_error` event rather than delivering it out of
 *     order. A `heartbeat` event goes out on the configured interval.
 *   - `POST /candidates` — the runtime submits one event or external action. Replies 202
 *     when accepted, 409 when rejected, 503 when the server wants the same candidate
 *     retried, and 401 when the token or the body does not check out.
 *
 * This file frames and bounds; it never decides. Commands, their order, and whether a
 * candidate becomes durable all come from the injected authority backed by Postgres, so a
 * bug in the wire format cannot hand out work or make runtime output durable by itself.
 *
 * Every authentication failure — no header, bad token, wrong audience, mismatched Pod UID,
 * malformed body — returns the same bare 401, so the response cannot be used to probe
 * which part was wrong.
 *
 * Called by: apps/opencrane/src/app/runtime-composition.ts, which mounts the
 * returned router on the server's internal listener.
 *
 * @param options - The two ports plus the fixed limits and timings; see
 *                  {@link RuntimeStreamTransportOptions}.
 * @returns An Express router with the two routes above, ready to mount.
 * @see https://html.spec.whatwg.org/multipage/server-sent-events.html — the
 *      `event:`/`data:` framing and the `text/event-stream` content type written here.
 * @see https://kubernetes.io/docs/reference/access-authn-authz/authentication/ — TokenReview
 *      and the bound-token audiences the reviewer checks before any of this runs.
 */
export function _RegisterInternalAgentRuntimeStream(options: RuntimeStreamTransportOptions): Router
{
	const router = Router();
	const wakeup = options.commandWakeup ?? new RuntimeCommandWakeup();
	router.use(json({ limit: options.maxBodyBytes, strict: true }));

	router.post("/stream", async function _openStream(request, response, next)
	{
		try
		{
			await ___DoWithTrace("agent_runtime.stream.open", {}, async function _open()
			{
				const identity = await _AuthenticateRuntime(_ReadBearerToken(request.header("authorization")), options);
				const open = _ParseStreamOpen(request.body);
				if (!identity || !open || identity.podUid !== open.podUid)
				{
					response.status(401).json({ code: "UNAUTHORIZED" });
					return;
				}

				response.status(200).set({ "Cache-Control": "no-store", Connection: "keep-alive", "Content-Type": "text/event-stream" });
				response.flushHeaders();
				let closed = false;
				let sequence = 0;
				const waitAbort = new AbortController();
				// Stream loss must bound in-flight command dispatch and let the injected authority release
				// the runtime-instance binding. The signal is a port call, never an import of the backend
				// authority package, so a lost connection cannot leave the attempt bound to a dead Pod.
				const cleanup = function _cleanup()
				{
					if (closed) return;
					closed = true;
					clearInterval(heartbeat);
					waitAbort.abort();
					void options.authority.__ReleaseStream?.(identity, open).catch(function _ignoreReleaseError() {});
				};
				const heartbeat = setInterval(function _heartbeat()
				{
					if (!closed)
					{
						_WriteEvent(response, "heartbeat", { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1 });
					}
				}, options.heartbeatMilliseconds);
				// An IncomingMessage closes after its finite POST body is read. The response is
				// the long-lived resource, so only it can end the command pump and heartbeat timer.
				response.once("close", cleanup);
				response.once("error", cleanup);

				// 1. Read Postgres before waiting: durable authority owns every command and replay decision.
				// 2. Forward only strictly newer immutable commands; never mint or reorder one here.
				// 3. Sleep until a local lifecycle hint or bounded recovery check, so idle streams do not poll each second.
				while (!closed)
				{
					const observedWakeRevision = wakeup.currentRevision();
					const command = await options.authority.__NextCommand(identity, open, sequence);
					if (closed)
					{
						break;
					}
					if (command)
					{
						if (command.sequence <= sequence)
						{
							_WriteEvent(response, "protocol_error", { code: "NON_MONOTONIC_COMMAND" });
							response.end();
							break;
						}
						sequence = command.sequence;
						_WriteEvent(response, "command", command);
						continue;
					}
					await wakeup.waitForChange(observedWakeRevision, options.commandRecoveryMilliseconds, waitAbort.signal);
				}
			});
		}
		catch (error)
		{
			next(error);
		}
	});

	router.post("/candidates", async function _admitCandidate(request, response, next)
	{
		try
		{
			const result = await ___DoWithTrace("agent_runtime.candidate.admit", {}, async function _admit(): Promise<RuntimeCandidateAdmission | null>
			{
				const identity = await _AuthenticateRuntime(_ReadBearerToken(request.header("authorization")), options);
				if (!identity || !_IsRuntimeCandidate(request.body))
				{
					return null;
				}
				return options.authority.__AdmitCandidate(identity, request.body);
			});
			if (!result)
			{
				response.status(401).json({ code: "UNAUTHORIZED" });
				return;
			}
			// Only external actions can currently make a resume command due. Waking on every accepted
			// event would turn high-frequency message deltas into a fleet-wide read burst; all other
			// lifecycle changes remain protected by the bounded durable recovery check.
			if (result.accepted && _IsRuntimeCandidate(request.body) && request.body.kind === "external_action") wakeup.wake();
			const responseStatus = result.accepted ? 202 : 409;
			response.status(result.retryable ? 503 : responseStatus).json(result);
		}
		catch (error)
		{
			next(error);
		}
	});

	return router;
}
