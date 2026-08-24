import { createHash } from "node:crypto";

import type { McpEraProbeTargetRecord } from "../core/mcp-operator-repository.types";
import { McpEraProbeFailureCodes } from "./mcp-era-probe-failure";
import { MCP_ERA_PROTOCOL_VERSION, McpEraProbeDecisions, McpEraProbeStates } from "./mcp-era-probe.types";
import type { McpEraProbeObservation, McpEraProbeTaskResult } from "./mcp-era-probe.types";

export { McpEraProbeStates } from "./mcp-era-probe.types";

/** Events that ask the protocol-check lifecycle for its next action. */
export enum McpEraProbeEvents
{
	/** Valid discovery announced the required revision. */
	ObservedAcceptedVersion = "observed_accepted_version",
	/** Valid discovery announced another revision. */
	ObservedOtherVersion = "observed_other_version",
	/** A temporary network or server failure may succeed later. */
	RetryableFailure = "retryable_failure",
	/** An unsafe endpoint or invalid response cannot be retried unchanged. */
	TerminalFailure = "terminal_failure",
	/** A duplicate task delivery asks for the stored winner. */
	Replay = "replay",
	/** An administrator asks to approve the server. */
	Approve = "approve",
	/** An administrator asks to publish the server. */
	Publish = "publish",
}

/** Closed actions produced by the protocol-check state table. */
export enum McpEraProbeActions
{
	/** Store accepted evidence. */
	Accept = "accept",
	/** Store rejected evidence. */
	Reject = "reject",
	/** Ask the workflow engine to retry later. */
	Retry = "retry",
	/** Return the result already stored by another delivery. */
	ReturnStored = "return_stored",
	/** Permit the requested catalogue governance change. */
	Allow = "allow",
	/** Refuse the requested catalogue governance change. */
	Deny = "deny",
	/** Reject an event that is not meaningful for the current state. */
	Invalid = "invalid",
}

/** One exhaustive state-by-event owner shared by replay, failure, and governance paths. */
const _TRANSITIONS: Readonly<Record<McpEraProbeStates, Readonly<Record<McpEraProbeEvents, McpEraProbeActions>>>> = {
	[McpEraProbeStates.NotRequired]: {
		[McpEraProbeEvents.ObservedAcceptedVersion]: McpEraProbeActions.Invalid,
		[McpEraProbeEvents.ObservedOtherVersion]: McpEraProbeActions.Invalid,
		[McpEraProbeEvents.RetryableFailure]: McpEraProbeActions.Invalid,
		[McpEraProbeEvents.TerminalFailure]: McpEraProbeActions.Invalid,
		[McpEraProbeEvents.Replay]: McpEraProbeActions.Invalid,
		[McpEraProbeEvents.Approve]: McpEraProbeActions.Allow,
		[McpEraProbeEvents.Publish]: McpEraProbeActions.Allow,
	},
	[McpEraProbeStates.Pending]: {
		[McpEraProbeEvents.ObservedAcceptedVersion]: McpEraProbeActions.Accept,
		[McpEraProbeEvents.ObservedOtherVersion]: McpEraProbeActions.Reject,
		[McpEraProbeEvents.RetryableFailure]: McpEraProbeActions.Retry,
		[McpEraProbeEvents.TerminalFailure]: McpEraProbeActions.Reject,
		[McpEraProbeEvents.Replay]: McpEraProbeActions.Invalid,
		[McpEraProbeEvents.Approve]: McpEraProbeActions.Deny,
		[McpEraProbeEvents.Publish]: McpEraProbeActions.Deny,
	},
	[McpEraProbeStates.Accepted]: {
		[McpEraProbeEvents.ObservedAcceptedVersion]: McpEraProbeActions.ReturnStored,
		[McpEraProbeEvents.ObservedOtherVersion]: McpEraProbeActions.ReturnStored,
		[McpEraProbeEvents.RetryableFailure]: McpEraProbeActions.ReturnStored,
		[McpEraProbeEvents.TerminalFailure]: McpEraProbeActions.ReturnStored,
		[McpEraProbeEvents.Replay]: McpEraProbeActions.ReturnStored,
		[McpEraProbeEvents.Approve]: McpEraProbeActions.Allow,
		[McpEraProbeEvents.Publish]: McpEraProbeActions.Allow,
	},
	[McpEraProbeStates.Rejected]: {
		[McpEraProbeEvents.ObservedAcceptedVersion]: McpEraProbeActions.ReturnStored,
		[McpEraProbeEvents.ObservedOtherVersion]: McpEraProbeActions.ReturnStored,
		[McpEraProbeEvents.RetryableFailure]: McpEraProbeActions.ReturnStored,
		[McpEraProbeEvents.TerminalFailure]: McpEraProbeActions.ReturnStored,
		[McpEraProbeEvents.Replay]: McpEraProbeActions.ReturnStored,
		[McpEraProbeEvents.Approve]: McpEraProbeActions.Deny,
		[McpEraProbeEvents.Publish]: McpEraProbeActions.Deny,
	},
};

/** Resolve one lifecycle action from stored state and a domain event. */
export function __McpEraProbeTransition(state: McpEraProbeStates, event: McpEraProbeEvents): McpEraProbeActions
{
	return _TRANSITIONS[state][event];
}

/** Narrow a stored string to the terminal failure codes allowed in final evidence. */
function _TerminalFailureCode(value: string): McpEraProbeFailureCodes | null
{
	if (value === McpEraProbeFailureCodes.UnsafeEndpoint) return McpEraProbeFailureCodes.UnsafeEndpoint;
	if (value === McpEraProbeFailureCodes.InvalidResponse) return McpEraProbeFailureCodes.InvalidResponse;
	if (value === McpEraProbeFailureCodes.RetryExhausted) return McpEraProbeFailureCodes.RetryExhausted;
	return null;
}

/** Derive a stored catalogue result from validated discovery evidence. */
export function __McpEraProbeObservationResult(observation: McpEraProbeObservation): McpEraProbeTaskResult
{
	const event = observation.protocolVersion === MCP_ERA_PROTOCOL_VERSION ? McpEraProbeEvents.ObservedAcceptedVersion : McpEraProbeEvents.ObservedOtherVersion;
	const action = __McpEraProbeTransition(McpEraProbeStates.Pending, event);
	return { decision: action === McpEraProbeActions.Accept ? McpEraProbeDecisions.Accepted : McpEraProbeDecisions.Rejected, protocolVersion: observation.protocolVersion, evidenceDigest: observation.evidenceDigest };
}

/** Convert a terminal domain failure into stable rejection evidence. */
export function __McpEraProbeTerminalResult(code: McpEraProbeFailureCodes): McpEraProbeTaskResult
{
	const action = __McpEraProbeTransition(McpEraProbeStates.Pending, McpEraProbeEvents.TerminalFailure);
	if (action !== McpEraProbeActions.Reject) throw new Error("MCP terminal failure transition is invalid.");
	const evidenceDigest = `sha256:${createHash("sha256").update(JSON.stringify(["mcp-era-probe-failure", code])).digest("hex")}` as const;
	return { decision: McpEraProbeDecisions.Rejected, failureCode: code, evidenceDigest };
}

/** Rebuild the final result selected by the stored winner. */
export function __McpEraProbeReplayResult(target: McpEraProbeTargetRecord): McpEraProbeTaskResult | null
{
	const state = target.eraProbeStatus;
	if (state === McpEraProbeStates.Pending) return null;
	if (__McpEraProbeTransition(state, McpEraProbeEvents.Replay) !== McpEraProbeActions.ReturnStored || !target.eraProbeEvidenceDigest) throw new Error("MCP stored protocol-check result is incomplete.");
	if (state === McpEraProbeStates.Accepted && target.eraProtocolVersion && !target.eraProbeFailureCode) return { decision: McpEraProbeDecisions.Accepted, protocolVersion: target.eraProtocolVersion, evidenceDigest: target.eraProbeEvidenceDigest as `sha256:${string}` };
	if (state === McpEraProbeStates.Rejected && target.eraProtocolVersion && !target.eraProbeFailureCode) return { decision: McpEraProbeDecisions.Rejected, protocolVersion: target.eraProtocolVersion, evidenceDigest: target.eraProbeEvidenceDigest as `sha256:${string}` };
	const failureCode = target.eraProbeFailureCode ? _TerminalFailureCode(target.eraProbeFailureCode) : null;
	if (state === McpEraProbeStates.Rejected && !target.eraProtocolVersion && failureCode) return { decision: McpEraProbeDecisions.Rejected, failureCode, evidenceDigest: target.eraProbeEvidenceDigest as `sha256:${string}` };
	throw new Error("MCP stored protocol-check result conflicts with its state.");
}

/** Return the probe states allowed to enter the requested governance state. */
export function __McpEraProbeRequiredStates(approvalStatus: string): readonly McpEraProbeStates[] | undefined
{
	let event: McpEraProbeEvents;
	if (approvalStatus === "Approved") event = McpEraProbeEvents.Approve;
	else if (approvalStatus === "Published") event = McpEraProbeEvents.Publish;
	else return undefined;
	return [McpEraProbeStates.Accepted, McpEraProbeStates.NotRequired].filter(function _Allowed(state) { return __McpEraProbeTransition(state, event) === McpEraProbeActions.Allow; });
}
