import { createHash } from "node:crypto";

import { AGENT_RUNTIME_PROTOCOL_VERSION, type CancelAttemptCommand, type RuntimeAssignment, type RuntimeCommand, type RuntimeCommandEnvelope } from "@opencrane/contracts";

import type { DispatchedCommandRow, RuntimeDispatchContext } from "./prisma-runtime-dispatch-authority.types";
import type { StoredRuntimeResumeInput } from "./runtime-resume-input.types";
import type { RuntimeAttemptAuthority } from "./runtime-protocol-authority.types";
import type { RuntimeCommandExtras } from "./runtime-command-envelope.types";

/** Build the pure authority value checked by both protocol directions. */
export function _BuildRuntimeAttemptAuthority(context: RuntimeDispatchContext, runtimeInstanceId: string, fence: number, nextCommandSequence: number, commands: readonly DispatchedCommandRow[], acceptedCandidateIds: readonly string[]): RuntimeAttemptAuthority
{
	return { runId: context.runId, attempt: context.attempt, fence, assignmentDigest: context.assignmentDigest, inputSnapshotDigest: context.inputSnapshotDigest, runtimeInstanceId, nextCommandSequence, acceptedCommandIds: commands.map(function _Id(row) { return row.commandId; }), acceptedCandidateIds: [...acceptedCandidateIds], leaseExpiresAtEpochMs: context.leaseExpiresAtEpochMs, runState: context.runState };
}

/** Rebuild a stored command's exact envelope for idempotent redelivery. */
export function _RebuildRuntimeCommandEnvelope(context: RuntimeDispatchContext, runtimeInstanceId: string, row: DispatchedCommandRow, extras: RuntimeCommandExtras): RuntimeCommandEnvelope
{
	const command = _CommandBody(context, row.kind, extras);
	return { protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION, runtimeInstanceId, commandId: row.commandId, sequence: row.sequence, fence: row.fence, issuedAt: row.issuedAt.toISOString(), expiresAt: row.expiresAt.toISOString(), assignment: _AssignmentFrame(context), ...command } as unknown as RuntimeCommandEnvelope;
}

/** Build a new command that never outlives its assignment lease. */
export function _MintRuntimeCommandEnvelope(context: RuntimeDispatchContext, runtimeInstanceId: string, fence: number, sequence: number, kind: DispatchedCommandRow["kind"], nowEpochMs: number, commandTtlMilliseconds: number, extras: RuntimeCommandExtras): RuntimeCommandEnvelope | null
{
	const expiresAtEpochMs = Math.min(nowEpochMs + commandTtlMilliseconds, context.leaseExpiresAtEpochMs);
	if (nowEpochMs >= expiresAtEpochMs)
		return null;
	const command = _CommandBody(context, kind, extras);
	return { protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION, runtimeInstanceId, commandId: _CommandId(context, sequence), sequence, fence, issuedAt: new Date(nowEpochMs).toISOString(), expiresAt: new Date(expiresAtEpochMs).toISOString(), assignment: _AssignmentFrame(context), ...command } as unknown as RuntimeCommandEnvelope;
}

/** Map one durable terminal reason to the command's fixed stop reason. */
export function _RuntimeCancelReason(terminalReason: RuntimeDispatchContext["terminalReason"]): CancelAttemptCommand["reason"]
{
	if (terminalReason === "BudgetExhausted")
		return "budget_exhausted";
	if (terminalReason === "PolicyDenied")
		return "capability_revoked";
	return "cancelled";
}

/** Build the assignment block carried by every command. */
function _AssignmentFrame(context: RuntimeDispatchContext): RuntimeAssignment
{
	return { runId: context.runId, attempt: context.attempt, agentServiceId: context.agentServiceId, agentRevisionId: context.agentRevisionId, personaRevisionId: context.personaRevisionId ?? undefined, siloId: context.siloId, executionSubject: context.executionSubject, serviceAccountName: context.serviceAccountName, podUid: context.podUid, assignmentDigest: context.assignmentDigest, issuedAt: context.assignmentIssuedAt, expiresAt: context.assignmentExpiresAt };
}

/** Internal command body before a resume receives decrypted continuation state. */
type DispatchCommandBody = Exclude<RuntimeCommand, { readonly kind: "resume_attempt" }> | { readonly kind: "resume_attempt"; readonly payload: StoredRuntimeResumeInput };

/** Build the body selected by one durable command kind. */
function _CommandBody(context: RuntimeDispatchContext, kind: DispatchedCommandRow["kind"], extras: RuntimeCommandExtras): DispatchCommandBody
{
	if (kind === "CancelAttempt")
		return { kind: "cancel_attempt", payload: { reason: extras.cancelReason } };
	if (kind === "ResumeAttempt")
	{
		if (extras.resume === null)
			throw new Error("runtime dispatch requires authorized deferred results for a resume_attempt frame");
		return { kind: "resume_attempt", payload: extras.resume };
	}
	if (extras.compiledInput === null)
		throw new Error("runtime dispatch requires compiled input for a start_attempt frame");
	return { kind: "start_attempt", payload: { snapshot: context.snapshot, compiledInput: extras.compiledInput } };
}

/** Derive a deterministic attempt-scoped command id. */
function _CommandId(context: RuntimeDispatchContext, sequence: number): string
{
	const canonical = JSON.stringify(["opencrane-runtime-command-id-v1", context.runId, context.attempt, sequence, context.assignmentDigest]);
	return `command-${createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 32)}`;
}
