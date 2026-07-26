import { createHash } from "node:crypto";

import type { JsonValue } from "@opencrane/util";
import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import type { ToolInvocationIntent, ToolInvocationReceipt, ToolInvocationRepository } from "@opencrane/backend/server/iam/authorization";

import type { ExecuteExternalActionCommand, ExecuteExternalActionResult, ExternalActionExecutor } from "./external-action-authority.types.js";

/** Returns whether a completed receipt still binds the exact validated invocation intent. */
function _receiptMatchesIntent<TResult>(receipt: ToolInvocationReceipt<TResult>, intent: ToolInvocationIntent): boolean
{
	return receipt.toolInvocationId === intent.toolInvocationId && receipt.requestFingerprint === intent.requestFingerprint;
}

/** Digest the exact validated tool authority and arguments so a mutated replay cannot reuse a row. */
function _requestFingerprint(command: ExecuteExternalActionCommand): string
{
	const candidate = command.candidate;
	const canonical = JSON.stringify(["opencrane-tool-invocation-fingerprint-v1", candidate.runId, candidate.attempt, candidate.toolRevisionId, candidate.toolInvocationId, candidate.argumentsDigest]);
	return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

/**
 * Validate a proposed external action against the immutable snapshot, then reserve before dispatch.
 *
 * This is the pure decision/persistence boundary for side-effecting tool calls, modelled exactly on
 * `__ExecuteCapabilityAction`: it takes an INJECTED {@link ToolInvocationRepository} and an INJECTED
 * {@link ExternalActionExecutor} so `scope:execution-protocol` never imports the concrete MCP, artifact,
 * memory, or sandbox transports — those are wired only in the `apps/opencrane` composition root.
 *
 * It (1) rejects any candidate whose `toolRevisionId` is not one of the compiled tool revisions the
 * snapshot's grants resolved to; (2) revalidates the arguments by recomputing their canonical digest
 * and refusing a mismatch; (3) reserves the ToolInvocation BEFORE any I/O so a crash leaves durable
 * evidence that blocks a retry; (4) for an approval-gated action, stops at the reservation and
 * returns `deferred` instead of dispatching; (5) otherwise dispatches the executor and completes the
 * receipt, marking a thrown action durably failed. A reserved/failed row is never re-executed and a
 * succeeded row replays only its canonical receipt.
 *
 * @param repository - Durable reserve-before-I/O tool-invocation authority.
 * @param command - Runtime candidate, immutable snapshot, compiled tools, and approval requirement.
 * @param executor - Deferred external tool invoked only for a fresh, non-deferred reservation.
 * @returns First execution, allowed idempotent replay, a deferred reservation, or fail-closed denial.
 */
export async function __ExecuteExternalAction<TResult>(repository: ToolInvocationRepository, command: ExecuteExternalActionCommand, executor: ExternalActionExecutor<TResult>): Promise<ExecuteExternalActionResult<TResult>>
{
	// 1. Bind the candidate to the immutable snapshot's run attempt before trusting any field.
	const candidate = command.candidate;
	if (candidate.runId !== command.snapshot.runId) return { outcome: "denied", reason: "run_attempt_mismatch" };

	// 2. The candidate revision must be one the snapshot's tool grants actually compiled to.
	if (!command.compiledTools.some(function _granted(tool) { return tool.toolRevisionId === candidate.toolRevisionId; })) return { outcome: "denied", reason: "tool_revision_not_granted" };

	// 3. Revalidate the arguments by recomputing their canonical digest; a mismatch is fail-closed.
	if (__DigestCanonicalJson(candidate.arguments as JsonValue) !== candidate.argumentsDigest) return { outcome: "denied", reason: "arguments_digest_mismatch" };

	// 4. Reserve the invocation before any external I/O so a crash cannot silently re-dispatch.
	const intent: ToolInvocationIntent = {
		siloId: command.snapshot.siloId,
		runId: candidate.runId,
		attempt: candidate.attempt,
		agentServiceId: command.snapshot.agentServiceId,
		agentRevisionId: command.snapshot.agentRevisionId,
		subjectId: command.snapshot.identitySnapshot.executionSubjectId,
		toolRevisionId: candidate.toolRevisionId,
		toolInvocationId: candidate.toolInvocationId,
		argumentsDigest: candidate.argumentsDigest,
		requestFingerprint: _requestFingerprint(command),
		approvalRequired: command.approvalRequired,
	};
	let reservation;
	try
	{
		reservation = await repository.reserve<TResult>(intent);
	}
	catch
	{
		return { outcome: "denied", reason: "invocation_reservation_failed" };
	}
	if (reservation.status === "existing_succeeded")
	{
		if (_receiptMatchesIntent(reservation.receipt, intent)) return { outcome: "replayed", receipt: reservation.receipt };
		return { outcome: "denied", reason: "invocation_replay" };
	}
	if (reservation.status !== "reserved") return { outcome: "denied", reason: "invocation_replay" };

	// 5. An approval-gated action stops at the durable reservation; the deferred approval decides it.
	if (command.approvalRequired) return { outcome: "deferred", reservationId: reservation.reservationId };

	// 6. Dispatch outside the reservation transaction, marking a thrown action durably failed.
	let result: TResult;
	try
	{
		result = await executor.execute();
	}
	catch
	{
		try
		{
			const failure = await repository.markFailed(reservation.reservationId, "executor_failed");
			if (failure.status === "conflict") return { outcome: "denied", reason: "invocation_execution_ambiguous" };
		}
		catch
		{
			return { outcome: "denied", reason: "invocation_execution_ambiguous" };
		}
		return { outcome: "denied", reason: "invocation_execution_failed" };
	}

	// 7. Complete only the exact reservation; a persistence conflict after I/O is ambiguous, never retried.
	try
	{
		const completion = await repository.markSucceeded(reservation.reservationId, result);
		if (completion.status === "conflict" || !_receiptMatchesIntent(completion.receipt, intent)) return { outcome: "denied", reason: "invocation_execution_ambiguous" };
		return { outcome: "executed", receipt: completion.receipt };
	}
	catch
	{
		return { outcome: "denied", reason: "invocation_execution_ambiguous" };
	}
}
