import type { AgentRunId } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

import type { CompiledRunInput } from "./compiled-run-input.types.js";
import type { RunInputSnapshot } from "./run-input-snapshot.types.js";
import type { RuntimeAssignment } from "./runtime-assignment.types.js";
import type { RuntimeElicitationProposal } from "./conversation-elicitation.types.js";

/** The only wire-protocol version the runtime boundary accepts today; a frame declaring anything else is rejected. */
export const AGENT_RUNTIME_PROTOCOL_V1 = "opencrane.agent-runtime/v1";

/** Sole projected-token audience accepted from first-party personal-agent runtimes. */
export const AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE = "opencrane-agent-runtime";

/**
 * Sole projected-token audience accepted from first-party managed (central) agent runtimes.
 *
 * Deliberately DIFFERENT from {@link AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE}: a personal runtime's
 * token must never satisfy the managed connector boundary, and vice versa, so the two workload
 * classes cannot borrow each other's network reach or downstream credentials.
 */
export const MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE = "opencrane-managed-agent-runtime";

/**
 * Sole managed-agent workload profile deployed by the initial controller composition.
 *
 * Keeping the value in the shared contract stops the definition API from accepting a profile
 * that the controller can never resolve into an executable workload.
 */
export const MANAGED_AGENT_RUNTIME_PROFILE_NAME = "managed-default";

/**
 * Return whether a ServiceAccount name is a personal-agent runtime name.
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

/** First message a runtime sends after opening its stream to the control plane. */
export interface RuntimeStreamOpen
{
	/** Versioned protocol the runtime is prepared to receive. */
	readonly protocolVersion: AgentRuntimeProtocolVersion;
	/** Ephemeral process identifier generated at runtime start. */
	readonly runtimeInstanceId: string;
	/** Pod UID read from the Kubernetes Downward API. It must match the identity in the runtime's projected token. */
	readonly podUid: string;
}

/** Header fields present on every command the control plane sends a runtime. */
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
	/** Server-owned fence number. A runtime must reject any frame whose fence is older than the current one. */
	readonly fence: number;
	/** ISO-8601 instant from which this command may be processed. */
	readonly issuedAt: string;
	/** ISO-8601 hard expiry after which this command is invalid. */
	readonly expiresAt: string;
	/** The workload assignment this command is addressed to. @see {@link RuntimeAssignment} */
	readonly assignment: RuntimeAssignment;
}

/** Command that starts one attempt. It carries both the run snapshot and the compiled input built from it. @see RunInputSnapshot @see CompiledRunInput */
export interface StartAttemptCommand
{
	/** The run snapshot. Nothing else may be used as run input. */
	readonly snapshot: RunInputSnapshot;
	/**
	 * Control-plane-compiled literal input for the bounded model/tool loop. It is opaque to the
	 * runtime, which consumes its fields without re-deriving persona, prompt, or tool assembly, and
	 * its `promptCompilerVersion` and `digest` must agree with the accompanying snapshot.
	 */
	readonly compiledInput: CompiledRunInput;
}

/** A tool result the server produced, either after calling the provider or after refusing the call outright. */
export type RuntimeToolResult =
	| { readonly toolInvocationId: string; readonly outcome: "succeeded"; readonly result: JsonValue }
	| { readonly toolInvocationId: string; readonly outcome: "failed"; readonly failureCode: string };

/** Command that resumes an attempt. It may carry only stored server-produced tool results and owner steering — nothing else. */
export interface ResumeAttemptCommand
{
	/** Input version number. The resume is rejected if it is no longer the current one. */
	readonly inputGeneration: number;
	/** Tool results in order. Each one's delivery row was consumed in the same transaction, so it can never be delivered twice. */
	readonly toolResults: readonly RuntimeToolResult[];
	/** Steering text the owner wrote, delivered once at this fenced command. */
	readonly steeringRequests: JsonValue;
	/** Exact server-owned elicitation results whose one-time delivery rows were consumed. */
	readonly elicitationResults: readonly RuntimeElicitationResult[];
}

/** Exact elicitation outcome delivered after the server accepts participant input. */
export interface RuntimeElicitationResult
{
	/** Stable server-owned request coordinate. */
	readonly requestId: string;
	/** Runtime caller-stable request key. */
	readonly requestKey: string;
	/** Accepted answer body or a terminal refusal marker. */
	readonly outcome: "answered" | "declined" | "expired" | "cancelled" | "failed";
	/** Answer content only for ordinary runtime input; protected strategy results stay server-side. */
	readonly response?: JsonValue;
}

/** Command that stops one attempt. The server decides the final state, not the runtime. */
export interface CancelAttemptCommand
{
	/** Stable server-defined cancellation reason. */
	readonly reason: "cancelled" | "deadline_exceeded" | "budget_exhausted" | "capability_revoked";
}

/** Stable command discriminants serialized on the runtime protocol. */
export enum RuntimeCommandKinds
{
	/** Starts one attempt from immutable input. */
	StartAttempt = "start_attempt",
	/** Resumes an attempt with server-owned results. */
	ResumeAttempt = "resume_attempt",
	/** Stops an attempt for a server-owned reason. */
	CancelAttempt = "cancel_attempt",
}

/** Versioned command union issued by the control plane to one runtime instance. */
export type RuntimeCommand =
	| { readonly kind: "start_attempt"; readonly payload: StartAttemptCommand }
	| { readonly kind: "resume_attempt"; readonly payload: ResumeAttemptCommand }
	| { readonly kind: "cancel_attempt"; readonly payload: CancelAttemptCommand };

/** Complete control-plane command frame sent on the runtime-initiated stream. */
export type RuntimeCommandEnvelope = RuntimeCommandCoordinates & RuntimeCommand;

/** Header fields required on every candidate a runtime returns. */
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
	/** Attempt number this candidate belongs to; its current fence must still match. */
	readonly attempt: number;
	/** Server-owned lease fence carried from the accepted command. */
	readonly fence: number;
}

/** Stable runtime-candidate discriminants serialized on the workload protocol. */
export enum RuntimeCandidateKinds
{
	/** Proposes one canonical run event for server admission. */
	Event = "event",
	/** Proposes one governed external action. */
	ExternalAction = "external_action",
	/** Proposes one participant input request. */
	Elicitation = "elicitation",
}

/** Runtime-proposed canonical event, never a direct durable write. */
export interface RuntimeEventCandidate extends RuntimeCandidateCoordinates
{
	/** Candidate category that requires control-plane event admission. */
	readonly kind: RuntimeCandidateKinds.Event;
	/** Proposed canonical event type. */
	readonly eventType: string;
	/** Validated, bounded event body for the control-plane authority to inspect. */
	readonly payload: JsonValue;
}

/** A request from the runtime to perform an external action. The control plane authorizes and performs it; the runtime never calls the tool itself. */
export interface RuntimeExternalActionCandidate extends RuntimeCandidateCoordinates
{
	/** Candidate category requiring deferred external-action authorization. */
	readonly kind: RuntimeCandidateKinds.ExternalAction;
	/** Immutable tool revision fixed by the accepted RunInputSnapshot. */
	readonly toolRevisionId: string;
	/** Caller-provided unique invocation identifier. */
	readonly toolInvocationId: string;
	/** Digest of normalized and validated action arguments. */
	readonly argumentsDigest: string;
	/** The arguments themselves, or a reference to them, so the server can validate them again. */
	readonly arguments: JsonValue;
}

/** Runtime proposal for participant input, never authority to choose the respondent. */
export interface RuntimeElicitationCandidate extends RuntimeCandidateCoordinates
{
	/** Candidate category requiring generic elicitation admission. */
	readonly kind: RuntimeCandidateKinds.Elicitation;
	/** Bounded proposal interpreted and bound by the server. */
	readonly proposal: RuntimeElicitationProposal;
}

/** Candidate union returned by the runtime to the control-plane authority. */
export type RuntimeCandidate = RuntimeEventCandidate | RuntimeExternalActionCandidate | RuntimeElicitationCandidate;
