import type { RuntimeCandidate, RuntimeCommandEnvelope, RuntimeStreamOpen } from "@opencrane/contracts";
import type { RuntimeTokenReviewer, RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";

import type { RuntimeCommandWakeup } from "./runtime-command-wakeup.js";

/**
 * The port through which this transport asks the server's real decision-maker what to do.
 *
 * The split matters: Postgres decides everything — which commands exist, in what order,
 * whether a candidate is accepted — and this package only frames those decisions as HTTP
 * and server-sent events. Nothing in this package may create a command, reorder one, or
 * accept work on its own, so a bug in the wire format cannot hand out work or make runtime
 * output durable.
 *
 * The `__` prefix marks a port the composition root wires in, not something to import
 * directly.
 *
 * Implemented by: `PrismaRuntimeDispatchAuthority` in
 * libs/backend/agents/execution/protocol/src/prisma-runtime-dispatch-authority.ts, built
 * by `__CreateProductionRuntimeDispatchAuthority`.
 * Called by: `_RegisterInternalAgentRuntimeStream` in ./agent-runtime-stream.ts; wired in
 * apps/opencrane/src/app/runtime-composition.ts.
 */
export interface RuntimeCommandStreamAuthority
{
	/**
	 * Read the next command for this runtime, or report that there is none right now.
	 *
	 * @param identity      - The workload identity TokenReview verified for this connection.
	 * @param open          - The stream-open message, naming the runtime instance and Pod UID.
	 * @param afterSequence - Return only a command with a strictly higher sequence number.
	 * @returns The next command, or null meaning "nothing due yet" — the caller then sleeps
	 *          until a local wake-up or the recovery deadline and asks again. Null is normal
	 *          and expected, not an error.
	 * @throws On a database failure; the transport lets it reach the Express error handler
	 *         rather than pretending the stream is idle.
	 */
	__NextCommand(identity: RuntimeWorkloadIdentity, open: RuntimeStreamOpen, afterSequence: number): Promise<RuntimeCommandEnvelope | null>;
	/**
	 * Offer one candidate — an event or an external action the runtime produced — to the
	 * decision-maker, which decides whether it becomes durable.
	 *
	 * @param identity  - The workload identity TokenReview verified for this request.
	 * @param candidate - The candidate, already shape-checked by the transport; its claim
	 *                    fence and attempt number are checked here, not in the transport.
	 * @returns Whether it was accepted, and if not, whether the runtime should retry the
	 *          exact same candidate. See {@link RuntimeCandidateAdmission}.
	 * @throws On a database failure; the transport turns that into a 500, not a rejection,
	 *         so the runtime does not treat an outage as a permanent refusal.
	 */
	__AdmitCandidate(identity: RuntimeWorkloadIdentity, candidate: RuntimeCandidate): Promise<RuntimeCandidateAdmission>;
	/**
	 * Tell the decision-maker that this stream is gone, so it can unbind the attempt from a
	 * Pod that is no longer listening. Called exactly once per closed stream, from the
	 * transport's cleanup, and its rejection is deliberately ignored — a failed release must
	 * not keep the connection's timers alive.
	 *
	 * Optional: an implementation without it simply leaves the binding to expire by its own
	 * timeout instead of being released promptly.
	 *
	 * @param identity - The identity verified when the stream opened.
	 * @param open     - The stream-open message for the stream that closed.
	 */
	__ReleaseStream?(identity: RuntimeWorkloadIdentity, open: RuntimeStreamOpen): Promise<void>;
}

/**
 * The answer to `POST /candidates`, and what the runtime must do next.
 *
 * The transport maps it to a status code, and the runtime is expected to branch on the
 * code: `retryable` gives 503, otherwise `accepted` gives 202 and a rejection gives 409.
 * Read {@link RuntimeCandidateAdmission.retryable} FIRST — a retryable result is not a
 * rejection, and treating it as one throws away work the server still expects.
 */
export interface RuntimeCandidateAdmission
{
	/**
	 * True when this candidate is now durable. Also true when the server recognised it as a
	 * repeat of one already stored, so a runtime that retries after a lost response gets the
	 * same answer instead of a duplicate or a conflict.
	 */
	readonly accepted: boolean;
	/** Short machine-readable code for why it was rejected; absent when accepted. */
	readonly reason?: string;
	/**
	 * True when the runtime should send this exact candidate again rather than give up on
	 * the attempt — a temporary condition on the server side, not a refusal.
	 */
	readonly retryable?: boolean;
	/** How long the runtime should wait before that retry, in milliseconds, when the server sets a delay. */
	readonly retryAfterMilliseconds?: number;
}

/**
 * Everything {@link _RegisterInternalAgentRuntimeStream} needs: the two ports it calls,
 * plus the limits and timings that keep the connection bounded.
 *
 * All of it is fixed when the router is built and cannot change per request, so a caller
 * cannot widen a limit by asking. apps/opencrane/src/app/runtime-composition.ts
 * is the only place these values are chosen.
 */
export interface RuntimeStreamTransportOptions
{
	/** Verifies the runtime's projected ServiceAccount token; the only source of caller identity. */
	readonly tokenReviewer: RuntimeTokenReviewer;
	/** The decision-maker this transport forwards to; see {@link RuntimeCommandStreamAuthority}. */
	readonly authority: RuntimeCommandStreamAuthority;
	/**
	 * Largest JSON body accepted on either route, in bytes. Enforced by the JSON parser, so
	 * an oversized body is refused before any handler runs. Currently 64 KiB.
	 */
	readonly maxBodyBytes: number;
	/**
	 * How often to send a `heartbeat` event on an otherwise silent stream, in milliseconds.
	 * Its job is to keep proxies from closing an idle connection and to let the runtime tell
	 * a live stream from a dead one. Currently 15 000.
	 */
	readonly heartbeatMilliseconds: number;
	/**
	 * How long a stream may sleep before re-reading Postgres anyway, in milliseconds. This is
	 * the safety net that makes a lost in-process wake-up harmless: the worst case is a
	 * command arriving this late, not one never arriving.
	 */
	readonly commandRecoveryMilliseconds: number;
	/**
	 * Shared wake-up object, so a candidate arriving on one request can nudge streams held
	 * open by others in the same process. Omit it and the router makes its own. It stores no
	 * commands and grants nothing, so a missed wake-up only delays the next read until
	 * {@link RuntimeStreamTransportOptions.commandRecoveryMilliseconds} expires.
	 */
	readonly commandWakeup?: RuntimeCommandWakeup;
}
