import type { AgentRunId } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

import type { CompiledRunInput } from "./compiled-run-input.types.js";
import type { RunInputSnapshot } from "./run-input-snapshot.types.js";
import type { RuntimeAssignment } from "./runtime-assignment.types.js";

/** The only wire-protocol version accepted by the initial runtime boundary. */
export const AGENT_RUNTIME_PROTOCOL_V1 = "opencrane.agent-runtime/v1";

/** Sole projected-token audience accepted from first-party personal-agent runtimes. */
export const AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE = "opencrane-agent-runtime";

/**
 * Sole projected-token audience accepted from first-party managed (central) agent runtimes.
 *
 * Deliberately DISTINCT from {@link AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE}: a personal runtime's
 * token must never satisfy the managed connector boundary, and vice versa, so the two workload
 * classes cannot borrow each other's network reach or downstream credentials.
 */
export const MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE = "opencrane-managed-agent-runtime";

/**
 * Sole managed-agent workload profile deployed by the initial controller composition.
 *
 * Keeping the value in the shared contract prevents the definition API from admitting a profile
 * that the controller can never resolve into an executable workload.
 */
export const MANAGED_AGENT_RUNTIME_PROFILE_NAME = "managed-default";

/**
 * Return whether a ServiceAccount belongs to the bounded first-party personal-runtime identity class.
 * @param value - Kubernetes ServiceAccount name to validate.
 * @returns True only for a valid personal-runtime-prefixed DNS label.
 */
export function ___IsAgentRuntimeServiceAccountName(value: string): boolean
{
	return value.length <= 63 && /^agent-runtime-[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value);
}

/**
 * Return whether a ServiceAccount belongs to the bounded managed (central) agent runtime identity
 * class. This is a NARROWER class than {@link ___IsAgentRuntimeServiceAccountName}: the
 * `managed-agent-runtime-` prefix never overlaps the personal `agent-runtime-` prefix, so a name
 * that satisfies one validator is rejected by the other and the connector-scoped identity of a
 * central agent can never be confused with a personal runtime's.
 * @param value - Kubernetes ServiceAccount name to validate.
 * @returns True only for a valid managed-runtime-prefixed DNS label.
 */
export function ___IsManagedAgentRuntimeServiceAccountName(value: string): boolean
{
	return value.length <= 63 && /^managed-agent-runtime-[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value);
}

/** Exact protocol version literal carried by every runtime frame. */
export type AgentRuntimeProtocolVersion = typeof AGENT_RUNTIME_PROTOCOL_V1;

/** Exact audience literal for a personal-agent runtime's projected ServiceAccount token. */
export type AgentRuntimeProjectedTokenAudience = typeof AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE;

/** Exact audience literal for a managed (central) agent runtime's projected ServiceAccount token. */
export type ManagedAgentRuntimeProjectedTokenAudience = typeof MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE;

/** Exact workload-profile literal accepted for managed agents by the initial composition. */
export type ManagedAgentRuntimeProfileName = typeof MANAGED_AGENT_RUNTIME_PROFILE_NAME;

/** Initial message sent by a runtime after it opens its control-plane stream. */
export interface RuntimeStreamOpen
{
	/** Versioned protocol the runtime is prepared to receive. */
	readonly protocolVersion: AgentRuntimeProtocolVersion;
	/** Ephemeral process identifier generated at runtime start. */
	readonly runtimeInstanceId: string;
	/** Downward-API pod UID which must agree with the reviewed projected-token identity. */
	readonly podUid: string;
}

/** Immutable command coordinates shared by every runtime-directed command. */
export interface RuntimeCommandCoordinates
{
	/** Versioned runtime protocol selected by the control plane. */
	readonly protocolVersion: AgentRuntimeProtocolVersion;
	/** Runtime process instance that opened the authenticated command stream. */
	readonly runtimeInstanceId: string;
	/** Opaque idempotency key assigned by the control plane for this frame. */
	readonly commandId: string;
	/** Strictly monotonic command sequence for one runtime instance. */
	readonly sequence: number;
	/** Server-owned lease fence invalidating frames from older attempts. */
	readonly fence: number;
	/** ISO-8601 instant from which this command may be processed. */
	readonly issuedAt: string;
	/** ISO-8601 hard expiry after which this command is invalid. */
	readonly expiresAt: string;
	/** Proof-bound workload assignment allowed to receive this command. */
	readonly assignment: RuntimeAssignment;
}

/** Starts one attempt with an exact immutable input snapshot and its compiled literal input. */
export interface StartAttemptCommand
{
	/** Canonical snapshot that is the sole runtime input authority. */
	readonly snapshot: RunInputSnapshot;
	/**
	 * Control-plane-compiled literal input for the bounded model/tool loop. It is opaque to the
	 * runtime, which consumes its fields without re-deriving persona, prompt, or tool assembly, and
	 * its `promptCompilerVersion` and `digest` must agree with the accompanying snapshot.
	 */
	readonly compiledInput: CompiledRunInput;
}

/** Resumes an attempt only with control-plane-authorized deferred results and steering. */
export type DeferredToolResumeResult =
	| { readonly approvalRequestId: string; readonly decision: "approved"; readonly toolInvocationId: string; readonly arguments: JsonValue; readonly argumentsDigest: string }
	| { readonly approvalRequestId: string; readonly decision: "denied" | "expired"; readonly toolInvocationId: string; readonly failureCode: "approval_denied" | "approval_expired" };

/** Resumes an attempt only with control-plane-authorized deferred results and steering. */
export interface ResumeAttemptCommand
{
	/** Monotonic input generation that must still be current at resume. */
	readonly inputGeneration: number;
	/** Exact ordered decisions for the approval batch whose markers were atomically consumed. */
	readonly deferredToolResults: readonly DeferredToolResumeResult[];
	/** Owner-authored steering consumed at this server-fenced command boundary. */
	readonly steeringRequests: JsonValue;
}

/** Stops one attempt without allowing the runtime to choose a terminal state. */
export interface CancelAttemptCommand
{
	/** Stable server-defined cancellation reason. */
	readonly reason: "cancelled" | "deadline_exceeded" | "budget_exhausted" | "capability_revoked";
}

/** Versioned command union issued by the control plane to one runtime instance. */
export type RuntimeCommand =
	| { readonly kind: "start_attempt"; readonly payload: StartAttemptCommand }
	| { readonly kind: "resume_attempt"; readonly payload: ResumeAttemptCommand }
	| { readonly kind: "cancel_attempt"; readonly payload: CancelAttemptCommand };

/** Complete control-plane command frame sent on the runtime-initiated stream. */
export type RuntimeCommandEnvelope = RuntimeCommandCoordinates & RuntimeCommand;

/** Coordinates required on every candidate returned by a runtime. */
export interface RuntimeCandidateCoordinates
{
	/** Versioned runtime protocol spoken by the candidate producer. */
	readonly protocolVersion: AgentRuntimeProtocolVersion;
	/** Runtime process instance returning the candidate. */
	readonly runtimeInstanceId: string;
	/** Command that caused this candidate. */
	readonly commandId: string;
	/** Candidate-local idempotency key. */
	readonly candidateId: string;
	/** Logical run receiving the candidate. */
	readonly runId: AgentRunId;
	/** Attempt whose current fence must accept the candidate. */
	readonly attempt: number;
	/** Server-owned lease fence carried from the accepted command. */
	readonly fence: number;
}

/** Runtime-proposed canonical event, never a direct durable write. */
export interface RuntimeEventCandidate extends RuntimeCandidateCoordinates
{
	/** Candidate category that requires control-plane event admission. */
	readonly kind: "event";
	/** Proposed canonical event type. */
	readonly eventType: string;
	/** Validated, bounded event body for the control-plane authority to inspect. */
	readonly payload: JsonValue;
}

/** Runtime request for an externally authorized action, never a direct tool call. */
export interface RuntimeExternalActionCandidate extends RuntimeCandidateCoordinates
{
	/** Candidate category requiring deferred external-action authorization. */
	readonly kind: "external_action";
	/** Immutable tool revision fixed by the accepted RunInputSnapshot. */
	readonly toolRevisionId: string;
	/** Caller-provided unique invocation identifier. */
	readonly toolInvocationId: string;
	/** Digest of normalized and validated action arguments. */
	readonly argumentsDigest: string;
	/** Protected argument payload or reference for server-side revalidation. */
	readonly arguments: JsonValue;
}

/** Candidate union returned by the runtime to the control-plane authority. */
export type RuntimeCandidate = RuntimeEventCandidate | RuntimeExternalActionCandidate;
