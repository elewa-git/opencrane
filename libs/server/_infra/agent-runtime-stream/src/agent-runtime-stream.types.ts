import type { RuntimeCandidate, RuntimeCommandEnvelope, RuntimeStreamOpen } from "@opencrane/contracts";

import type { RuntimeCommandWakeup } from "./runtime-command-wakeup.js";

/** Verified workload identity associated with one runtime-initiated connection. */
export interface RuntimeWorkloadIdentity
{
	/** Kubernetes ServiceAccount subject returned by TokenReview. */
	readonly subject: string;
	/** Kubernetes namespace parsed from the authenticated subject. */
	readonly namespace: string;
	/** Kubernetes ServiceAccount name parsed from the authenticated subject. */
	readonly serviceAccountName: string;
	/** Kubernetes Pod UID asserted by TokenReview for this projected token. */
	readonly podUid: string;
}

/** Minimal TokenReview seam; the app supplies the Kubernetes API implementation. */
export interface RuntimeTokenReviewer
{
	/** Verify a projected token and return the authenticated workload identity. */
	__Review(token: string): Promise<RuntimeWorkloadIdentity | null>;
}

/** Durable command authority injected by the server app, never owned by this transport. */
export interface RuntimeCommandStreamAuthority
{
	/** Return the next server-issued command after the supplied sequence, or wait boundedly. */
	__NextCommand(identity: RuntimeWorkloadIdentity, open: RuntimeStreamOpen, afterSequence: number): Promise<RuntimeCommandEnvelope | null>;
	/** Admit a runtime candidate through the authoritative run boundary. */
	__AdmitCandidate(identity: RuntimeWorkloadIdentity, candidate: RuntimeCandidate): Promise<RuntimeCandidateAdmission>;
	/** Signal that an authenticated runtime stream was lost so the authority can release its binding. */
	__ReleaseStream?(identity: RuntimeWorkloadIdentity, open: RuntimeStreamOpen): Promise<void>;
}

/** Stable result sent after a candidate reaches the authoritative run boundary. */
export interface RuntimeCandidateAdmission
{
	/** Whether the authority accepted this candidate or its idempotent replay. */
	readonly accepted: boolean;
	/** Machine-readable reason when the candidate was rejected. */
	readonly reason?: string;
	/** Whether the runtime must retry this exact candidate instead of terminalising its attempt. */
	readonly retryable?: boolean;
	/** Server-bounded retry delay for one retryable candidate admission. */
	readonly retryAfterMilliseconds?: number;
}

/** Transport configuration that fixes bounded framing and heartbeat behavior. */
export interface RuntimeStreamTransportOptions
{
	/** Token reviewer for the runtime's projected ServiceAccount credential. */
	readonly tokenReviewer: RuntimeTokenReviewer;
	/** Server-owned command/candidate authority. */
	readonly authority: RuntimeCommandStreamAuthority;
	/** Maximum accepted JSON request body in bytes. */
	readonly maxBodyBytes: number;
	/** Heartbeat interval for an idle, runtime-initiated SSE connection. */
	readonly heartbeatMilliseconds: number;
	/** Bounded durable recovery interval after a local wake-up is missed or unavailable. */
	readonly commandRecoveryMilliseconds: number;
	/** Optional process-local wake-up fan-out; it never stores or authorizes commands. */
	readonly commandWakeup?: RuntimeCommandWakeup;
}
